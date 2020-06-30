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
		undefined,
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
	.option('--hoursinaday <hoursinaday>', 'Defines how many worklog hours in a day', prog.FLOAT, 6, false)
	.option('--daysinayear <daysinayear>', 'Defines how many working days in a year', prog.FLOAT, 247, false)
	.option(
		'--itemtype <itemtype>',
		'Allows you to choose one of the predefined filters: SupportRequests or ExternalBugs',
		(value) => {
			switch (value.toLowerCase()) {
				case 'supportrequests':
					return 'Type = SupportRequest';
				case 'externalbugs':
					return "Type = Bug and 'How Found' = External";
				default:
					throw Error('Unsupported predefined filter');
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
	.option('--showtotal', 'Shows the totals', prog.BOOL, true, false)
	.action(
		async (
			args,
			{
				url,
				username,
				password,
				query,
				assignees,
				timeperiod,
				hoursinaday,
				daysinayear,
				itemtype,
				delimiter,
				nounits,
				humanize,
				colorize,
				showtotal
			},
			logger
		) => {
			assignees = assignees.map((a) => a.trim());
			const baseUrl = new URL('/rest/api/latest/', url);
			const api = new JiraApi(baseUrl, username, password);
			let fullQuery = `worklogAuthor in (${assignees.join(',')})`;
			if (timeperiod) {
				fullQuery = `worklogDate >= ${timeperiod.start} AND worklogDate <= ${timeperiod.end} AND ${fullQuery}`;
			}
			if (itemtype) {
				fullQuery = `${itemtype} AND ${fullQuery}`;
			}
			if (query) {
				fullQuery = `${fullQuery} AND (${query})`;
			}
			if (fullQuery) logger.debug('The JQL query has been prepared', { fullQuery });
			const result = {};

			const searchResult = await api.searchItems(fullQuery);

			logger.debug('The items have been retrieved from JIRA', { itemsCount: searchResult.issues.length });

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

			let totalDuration = 0;

			const formatDuration = (duration) => {
				let durationStr;

				if (humanize) {
					durationStr = humanizeDuration(duration * 1000, {
						unitMeasures: {
							ms: 1,
							s: 1000,
							m: 1000 * 60,
							h: 1000 * 60 * 60,
							d: 1000 * 60 * 60 * hoursinaday,
							w: 1000 * 60 * 60 * hoursinaday * (daysinayear / (365.25 / 7)),
							mo: 1000 * 60 * 60 * hoursinaday * (daysinayear / 12),
							y: 1000 * 60 * 60 * hoursinaday * daysinayear
						},
						units: [ 'y', 'mo', 'w', 'd', 'h', 'm' ],
						round: true
					});
				} else {
					durationStr = (duration / 60 / 60 / hoursinaday).toFixed(2);
					if (!nounits) durationStr += 'd';
				}

				return durationStr;
			};

			for (let user in result) {
				const duration = result[user];
				totalDuration += duration;
				let durationStr = formatDuration(duration);

				if (colorize) {
					user = chalk.bold.blue(user);
					durationStr = chalk.green(durationStr);
				}

				console.log(`${user}${delimiter}${durationStr}`);
			}

			if (showtotal) {
				console.log();
				let totalTitle = 'Total:';
				let totalStr = formatDuration(totalDuration);

				if (colorize) {
					totalTitle = chalk.bold.underline.blueBright(totalTitle);
					totalStr = chalk.bold.greenBright(totalStr);
				}

				console.log(totalTitle, totalStr);
			}
		}
	);

prog.parse(process.argv);
