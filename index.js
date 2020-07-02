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
		'--orderby <orderby>',
		'Specifies a sort order: username or duration',
		(value) => {
			switch (value.toLowerCase()) {
				case 'username':
				case 'duration':
					return value;
			}
			throw Error('Unsupported sort order');
		},
		'username',
		false
	)
	.option(
		'--delimiter <delimiter>',
		'Delimiter that is used in the output to separate the username and the duration',
		prog.STRING,
		'  ',
		false
	)
	.option('--humanize', 'Format the worklog duration to a human-readable format', prog.BOOL)
	.option('--nounits', 'Omit the units for the worklog duration, printing only the numbers', prog.BOOL)
	.option('--no-color', 'Disable colors', prog.BOOL, false, false)
	.option('--hidetotal', 'Hide the totals', prog.BOOL)
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
				orderby,
				delimiter,
				nounits,
				humanize,
				nocolor,
				hidetotal
			},
			logger
		) => {
			assignees = assignees.map((a) => a.trim().toLowerCase());
			const baseUrl = new URL('/rest/api/latest/', url);
			const api = new JiraApi(baseUrl, username, password, logger);
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
				const { key } = item;

				if (worklog.total > worklog.maxResults) {
					worklog = await api.getWorklogByItemKey(key);
				}

				for (let worklogItem of worklog.worklogs) {
					const user = worklogItem.author.key.toLowerCase();

					if (assignees.includes(user)) {
						if (!result[user]) result[user] = { total: 0 };
						if (!result[user][key]) result[user][key] = 0;
						result[user][key] += worklogItem.timeSpentSeconds;
						result[user].total += worklogItem.timeSpentSeconds;
					}
				}
			}

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

			const orderedResult = Object.keys(result).map((k) => ({ username: k, duration: result[k].total }));

			switch (orderby) {
				case 'username':
					orderedResult.sort((a, b) => a.username.localeCompare(b.username, 'en-US'));
					break;
				case 'duration':
					orderedResult.sort((a, b) => b.duration - a.duration);
					break;
			}

			let totalDuration = 0;

			for (let { username, duration } of orderedResult) {
				totalDuration += duration;
				let durationStr = formatDuration(duration);

				if (!nocolor) {
					username = chalk.bold.blue(username);
					durationStr = chalk.green(durationStr);
				}

				console.log(`${username}${delimiter}${durationStr}`);
			}

			if (!hidetotal) {
				console.log();
				let totalTitle = 'Total';
				let totalStr = formatDuration(totalDuration);

				if (!nocolor) {
					totalTitle = chalk.bold.underline.blueBright(totalTitle);
					totalStr = chalk.bold.greenBright(totalStr);
				}

				console.log(`${totalTitle}${delimiter}${totalStr}`);
			}
		}
	);

prog.parse(process.argv);
