#!/usr/bin/env node
process.removeAllListeners('warning'); // to disable 'ExperimentalWarning: The fs.promises API is experimental'

const pkg = require('./package.json');
const prog = require('caporal');
const humanizeDuration = require('humanize-duration');
const moment = require('moment');
const chalk = require('chalk');
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
		'-t, --timeperiod <timeperiod>',
		'A period of time (a quarter or a month) to retrieve the worklog for. E.g., 2020 Q3, 2020-06, January, 2020, etc.',
		(value) => {
			const quarterFormats = [ 'YYYY \\QQ', 'YYYY, \\QQ' ];
			const monthFormats = [ 'YYYY-MM', 'YYYY MM', 'MMM, YYYY', 'MMMM, YYYY' ];

			const m = moment(value, quarterFormats.concat(monthFormats), 'en', true);
			if (m.isValid()) {
				const format = m.creationData().format;
				let unit;
				if (quarterFormats.includes(format)) {
					unit = 'quarter';
				} else {
					unit = 'month';
				}

				return { start: m.startOf(unit).format('YYYY-MM-DD'), end: m.endOf(unit).format('YYYY-MM-DD') };
			} else {
				throw Error('Invalid date period');
			}
		},
		undefined,
		false
	)
	.option(
		'--delimiter <delimiter>',
		'Delimiter that is used in the output to separate the username and the duration',
		prog.STRING,
		'  ',
		false
	)
	.option('--humanize', 'Formats the worklog duration to a human-readable format', prog.BOOL, false, false)
	.option('--nounits', 'Omits the units for the worklog duration, printing only the numbers', prog.BOOL, false, false)
	.option('-c, --colorize', 'Colorizes the console output', prog.BOOL, false, false)
	.action(
		async (
			args,
			{ url, username, password, query, assignees, timeperiod, delimiter, nounits, humanize, colorize },
			logger
		) => {
			const baseUrl = new URL('/rest/api/latest/', url);
			const api = new JiraApi(baseUrl, username, password);
			query = `worklogAuthor in (${assignees.join(',')}) AND (${query})`;
			if (timeperiod) {
				query = `worklogDate >= ${timeperiod.start} AND worklogDate <= ${timeperiod.end} AND ${query}`;
			}
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

				if (colorize) {
					user = chalk.bold.blue(user);
					durationStr = chalk.green(durationStr);
				}
				console.log(`${user}${delimiter}${durationStr}`);
			}
		}
	);

prog.parse(process.argv);
