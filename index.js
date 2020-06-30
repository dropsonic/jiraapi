#!/usr/bin/env node
process.removeAllListeners('warning'); // to disable 'ExperimentalWarning: The fs.promises API is experimental'

const pkg = require('./package.json');
const prog = require('caporal');
const humanizeDuration = require('humanize-duration');
const { JiraApi } = require('./api');

prog
	.version(pkg.version)
	.name(pkg.name)
	.description(pkg.description)
	.bin(Object.keys(pkg.bin)[0])
	.command('worklog', 'Retrieves a worklog for all items returned by a JQL query')
	.option('-j, --url <url>', 'JIRA URL', prog.STRING, 'https://jira.acumatica.com', false)
	.option('-u, --username <username>', 'Username', prog.STRING, undefined, true)
	.option('-p, --password <password>', 'Password', prog.STRING, undefined, true)
	.option(
		'-q, --query <query>',
		'A JQL query to retrieve the items. "worklogAuthor" clause is added automatically',
		prog.STRING,
		'',
		false
	)
	.option(
		'-a, --assignees <assignees>',
		'A comma-separated list of assignees to get the worklog for',
		prog.LIST,
		undefined,
		true
	)
	.option(
		'-d, --delimiter <delimiter>',
		'Delimiter that is used in the output to separate the username and the duration',
		prog.STRING,
		'  ',
		false
	)
	.option('--humanize', 'Formats the worklog duration to a human-readable format', prog.BOOL, false, false)
	.option('--nounits', 'Omits the units for the worklog duration, printing only the numbers', prog.BOOL, false, false)
	.action(async (args, { url, username, password, query, assignees, delimiter, nounits, humanize }, logger) => {
		const baseUrl = new URL('/rest/api/latest/', url);
		const api = new JiraApi(baseUrl, username, password);
		query = `worklogAuthor in (${assignees.join(',')}) AND (${query})`;
		const result = {};

		const searchResult = await api.searchItems(query);

		for (let item of searchResult.issues) {
			let { worklog } = item.fields;

			if (worklog.total > worklog.maxResults) {
				worklog = await api.getWorklogByItemKey(item.key);
			}

			for (let worklogItem of worklog.worklogs) {
				const user = worklogItem.author.key;

				if (assignees.includes(user)) {
					if (!result[user]) result[user] = 0;
					result[user] += worklogItem.timeSpentSeconds;
				}
			}
		}

		for (let user in result) {
			const hoursInDay = 6;
			const duration = result[user];
			let durationStr;

			if (humanize) {
				durationStr = humanizeDuration(duration * 1000);
			} else {
				durationStr = duration / 60 / 60 / hoursInDay;
				if (!nounits) durationStr += 'd';
			}

			console.log(`${user}${delimiter}${durationStr}`);
			// console.log(chalk.bold.blue(`${user}`), chalk.green(`${days}d`));
		}
	});

prog.parse(process.argv);
