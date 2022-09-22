#!/usr/bin/env node

// Fix embedded hyperlinks for Windows Terminal (see https://github.com/jamestalmage/supports-hyperlinks/issues/7)
if (process.env.WT_SESSION) {
  process.env.FORCE_HYPERLINK = 1;
}

// Workaround for importing JSON files as ES6 modules since it is still an experimental feature
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
//import pkg from './package.json' assert { type: 'json' };
const pkg = require('./package.json');

import prog from 'caporal';
import _ from 'lodash';
import humanizeDuration from 'humanize-duration';
import moment from 'moment';
import chalk from 'chalk';
import terminalLink from 'terminal-link';
import prompt from 'prompt';
import keytar from 'keytar';
import cliProgress from 'cli-progress';
import util from 'util';
import { performance, PerformanceObserver } from 'perf_hooks';
import {
  JiraApi,
  InvalidCredentialsError,
  AccessDeniedError,
  BadRequestError,
} from './api.js';

prompt.message = '';

prog
  .version(pkg.version)
  .name(pkg.name)
  .description(pkg.description)
  .bin(Object.keys(pkg.bin)[0])
  .command(
    'worklog',
    'Retrieves a worklog for all items returned by a JQL query'
  )
  .option(
    '-j, --url <url>',
    'JIRA URL',
    prog.STRING,
    'https://jira.acumatica.com',
    false
  )
  .option(
    '-q, --query <query>',
    'A JQL query to retrieve the items. "worklogAuthor" clause is added automatically',
    prog.STRING,
    undefined,
    false
  )
  .option(
    '-a, --assignees <assignees>',
    'A comma-separated list of assignees to get the worklog for. A full name, email, JIRA username or their parts can be used to search for the assignee. In case of ambiguity, the system will ask you which user to choose.',
    prog.LIST,
    undefined,
    true
  )
  .option(
    '-t, --timeperiod <timeperiod>',
    'A period of time (a quarter or a month) to retrieve the worklog for. E.g., 2020 Q3, 2020-06, January, 2020, 2022-09-17, etc.',
    (value) => {
      const quarterFormats = ['YYYY \\QQ', 'YYYY, \\QQ'];
      const monthFormats = ['YYYY-MM', 'YYYY MM', 'MMM, YYYY', 'MMMM, YYYY'];
      const dayFormats = ['YYYY-MM-DD', 'YYYY MM DD'];

      const m = moment(
        value,
        quarterFormats.concat(monthFormats).concat(dayFormats),
        'en',
        true
      );
      if (m.isValid()) {
        const format = m.creationData().format;
        let unit;
        if (quarterFormats.includes(format)) {
          unit = 'quarter';
        } else if (monthFormats.includes(format)) {
          unit = 'month';
        } else {
          unit = 'day';
        }

        return { start: m.clone().startOf(unit), end: m.clone().endOf(unit) };
      } else {
        throw Error('Invalid date period');
      }
    },
    undefined,
    false
  )
  .option(
    '--hoursinaday <hoursinaday>',
    'Defines how many worklog hours in a day',
    prog.FLOAT,
    6,
    false
  )
  .option(
    '--daysinayear <daysinayear>',
    'Defines how many working days in a year',
    prog.FLOAT,
    247,
    false
  )
  .option('-d, --detailed', 'Show the detailed worklog for each JIRA item')
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
    '\t',
    false
  )
  .option(
    '--humanize',
    'Format the worklog duration to a human-readable format',
    prog.BOOL
  )
  .option(
    '--nounits',
    'Omit the units for the worklog duration, printing only the numbers',
    prog.BOOL
  )
  .option('--no-color', 'Disable colors', prog.BOOL, false, false)
  .option('--hidetotal', 'Hide the totals', prog.BOOL)
  .option(
    '--useusernames',
    'Shows usernames instead of display names in the results',
    prog.BOOL,
    false,
    false
  )
  .action(
    async (
      args,
      {
        url,
        query,
        assignees,
        timeperiod,
        hoursinaday,
        daysinayear,
        detailed,
        itemtype,
        orderby,
        delimiter,
        nounits,
        humanize,
        nocolor,
        hidetotal,
        useusernames,
      },
      logger
    ) => {
      const perfObserver = new PerformanceObserver((list, observer) => {
        logger.debug('Timings', list.getEntries());
      });
      perfObserver.observe({ entryTypes: ['measure'] });
      performance.mark('start');

      const styles = {
        users: {
          searchQuery: nocolor ? chalk.reset : chalk.blue,
          userIndex: nocolor ? chalk.reset : chalk.bold.blueBright,
          username: nocolor ? chalk.reset : chalk.reset,
          email: nocolor ? chalk.reset : chalk.grey,
          displayName: nocolor ? chalk.reset : chalk.reset,
        },
        results: {
          username: nocolor ? chalk.reset : chalk.bold.blue,
          duration: nocolor ? chalk.reset : chalk.green,
          issueKey: nocolor ? chalk.reset : chalk.bold.cyan,
          total: {
            title: nocolor ? chalk.reset : chalk.bold.underline.blueBright,
            duration: nocolor ? chalk.reset : chalk.bold.greenBright,
          },
        },
      };

      const getPrompt = util.promisify(prompt.get); // the default "get" method doesn't work properly with async/await
      const askForCredentials = async () => {
        const { username, password } = await getPrompt({
          properties: {
            username: {
              description: 'Enter your username',
              message: 'Username cannot be empty',
              type: 'string',
              required: true,
            },
            password: {
              description: 'Enter your password',
              message: 'Password cannot be empty',
              type: 'string',
              required: true,
              hidden: true,
              replace: '*',
            },
          },
        });

        await keytar.setPassword(pkg.name, username, password);
        logger.debug('Credentials were saved to the credentials manager', {
          username,
        });

        return { username, password };
      };

      const executeApiAction = async (action) => {
        while (true) {
          try {
            return await action();
          } catch (error) {
            if (
              error instanceof InvalidCredentialsError ||
              error instanceof AccessDeniedError
            ) {
              logger.error(error.message);
              await keytar.deletePassword(pkg.name, username);
              api.credentials = await askForCredentials();
            } else {
              throw error;
            }
          }
        }
      };

      const createProgressBar = (text) => {
        return new cliProgress.SingleBar(
          {
            clearOnComplete: true,
            hideCursor: true,
            format: `${text} {bar} {percentage}% | ETA: {eta}s`,
          },
          cliProgress.Presets.shades_classic
        );
      };

      // ---------------------------------------------------------------------

      let username, password;
      const savedCredentials = await keytar.findCredentials(pkg.name);

      if (savedCredentials && savedCredentials.length > 0) {
        ({ account: username, password } = savedCredentials[0]);
        logger.debug(
          'Saved credentials were retrieved from the credentials manager',
          { username }
        );
      } else {
        ({ username, password } = await askForCredentials());
      }

      const api = new JiraApi(url, username, password, { logger });

      const usersProgressBar = createProgressBar(
        'Searching for the assignees in JIRA...'
      );
      usersProgressBar.start(assignees.length, 0);
      try {
        for (let i = 0; i < assignees.length; i++) {
          const assigneeSearchQuery = assignees[i].trim();
          const users = await executeApiAction(
            async () => await api.searchUsers(assigneeSearchQuery)
          );

          usersProgressBar.increment();

          let userIndex;
          if (users.length == 0) {
            throw Error(
              `A user '${styles.users.searchQuery(
                assigneeSearchQuery
              )}' cannot be found in JIRA.`
            );
          } else if (users.length == 1) {
            userIndex = 1;
          } else {
            userIndex =
              users.findIndex(
                (u) =>
                  u.email === assigneeSearchQuery ||
                  u.key === assigneeSearchQuery ||
                  u.name === assigneeSearchQuery
              ) + 1;

            if (userIndex <= 0) {
              usersProgressBar.stop();
              console.log(
                `Multiple JIRA users have been found for '${styles.users.searchQuery(
                  assigneeSearchQuery
                )}':`
              );

              for (let j = 0; j < users.length; j++) {
                const user = users[j];
                console.log(
                  `(${styles.users.userIndex(
                    j + 1
                  )}) ${styles.users.displayName(
                    user.displayName
                  )} ${styles.users.email(
                    `<${user.emailAddress}>`
                  )} (${styles.users.username(user.name)})`
                );
              }

              ({ userIndex } = await getPrompt({
                properties: {
                  userIndex: {
                    description:
                      'Please choose the desired user by entering its number',
                    message:
                      'You must choose a user from the list by entering a valid index',
                    type: 'integer',
                    required: true,
                    conform: (value) => value >= 1 && value <= users.length,
                  },
                },
              }));

              console.log();
              usersProgressBar.start(assignees.length, i + 1);
            }
          }

          assignees[i] = users[userIndex - 1];
        }
      } finally {
        usersProgressBar.stop();
      }

      const result = {};
      let searchResult;
      assignees
        .map((a) => a.key.trim().toLowerCase())
        .forEach((a) => (result[a] = { [Symbol.for('total')]: 0 }));

      let fullQuery = `worklogAuthor in (${assignees
        .map((a) => a.name)
        .join(',')})`;
      if (timeperiod) {
        fullQuery = `worklogDate >= ${timeperiod.start.format(
          'YYYY-MM-DD'
        )} AND worklogDate <= ${timeperiod.end.format(
          'YYYY-MM-DD'
        )} AND ${fullQuery}`;
      }
      if (itemtype) {
        fullQuery = `${itemtype} AND ${fullQuery}`;
      }
      if (query) {
        fullQuery = `${fullQuery} AND (${query})`;
      }
      if (fullQuery) {
        logger.debug('The JQL query has been prepared', { fullQuery });
        // Expand subtasks using functions from Adaptavist ScriptRunner plugin. If it is not installed, use the default (fallback) path.
        const quoteChar = fullQuery.includes("'") ? '"' : "'";
        const scriptedQuery = `(${fullQuery}) OR issueFunction in subtasksOf(${quoteChar}${fullQuery}${quoteChar})`;
        logger.debug(
          'The JQL query has been prepared, expanding subtasks by using Adaptivist ScriptRunner',
          { scriptedQuery }
        );

        try {
          searchResult = await executeApiAction(
            async () => await api.searchItems(scriptedQuery)
          );
        } catch (error) {
          if (error instanceof BadRequestError)
            logger.debug('Adaptavist ScriptRunner plugin is not installed');
          else throw error;
        }
      }

      if (!searchResult) {
        searchResult = await executeApiAction(
          async () => await api.searchItems(fullQuery, { subtasks: true })
        );
      }

      const allItems = _.chain(searchResult.issues)
        .reduce((acc, i) => {
          acc.push(i);
          const { subtasks } = i.fields;
          if (subtasks) acc.push(...subtasks);
          return acc;
        }, [])
        .sortBy('fields.worklog') // move all expanded subtasks without worklog to the end of the list because they can be duplicated but with a worklog
        .uniqBy((i) => i.key)
        .value();

      logger.debug('The items have been retrieved from JIRA', {
        itemsCount: searchResult.issues.length,
        subitemsCount: allItems.length - searchResult.issues.length,
      });

      const worklogProgressBar = createProgressBar(
        'Getting the details from JIRA...'
      );
      worklogProgressBar.start(allItems.length, 0);

      try {
        for (let item of allItems) {
          let { worklog } = item.fields;
          const { key } = item;

          if (!worklog || worklog.total > worklog.maxResults) {
            worklog = await executeApiAction(
              async () => await api.getWorklogByItemKey(key)
            );
          }

          for (let worklogItem of worklog.worklogs) {
            const user = worklogItem.author.key.trim().toLowerCase();

            if (result[user]) {
              let duration = worklogItem.timeSpentSeconds;
              let shouldAddDuration = false;

              if (timeperiod) {
                let started = moment(worklogItem.started);
                let ended = started
                  .clone()
                  .add(worklogItem.timeSpentSeconds, 's');

                if (
                  started.isBetween(timeperiod.start, timeperiod.end) ||
                  ended.isBetween(timeperiod.start, timeperiod.end)
                ) {
                  if (started.isBefore(timeperiod.start))
                    started = timeperiod.start;
                  if (ended.isAfter(timeperiod.end)) ended = timeperiod.end;

                  duration = ended.diff(started, 's');
                  shouldAddDuration = true;
                }
              } else {
                shouldAddDuration = true;
              }

              if (shouldAddDuration) {
                if (!result[user][key]) result[user][key] = 0;
                result[user][key] += duration;
                result[user][Symbol.for('total')] += duration;
              }
            }
          }

          worklogProgressBar.increment();
        }
      } finally {
        worklogProgressBar.stop();
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
              y: 1000 * 60 * 60 * hoursinaday * daysinayear,
            },
            units: ['y', 'mo', 'w', 'd', 'h', 'm'],
            round: true,
          });
        } else {
          durationStr = (duration / 60 / 60 / hoursinaday).toFixed(2);
          if (!nounits) durationStr += 'd';
        }

        return durationStr;
      };

      const orderedResult = Object.keys(result).map((k) => ({
        username: k,
        duration: result[k][Symbol.for('total')],
        details: Object.keys(result[k])
          .map((dk) => ({ key: dk, duration: result[k][dk] }))
          .sort((a, b) => b.duration - a.duration),
      }));

      switch (orderby) {
        case 'username':
          orderedResult.sort((a, b) =>
            a.username.localeCompare(b.username, 'en-US')
          );
          break;
        case 'duration':
          orderedResult.sort((a, b) => b.duration - a.duration);
          break;
      }

      let totalDuration = 0;

      for (let { username, duration, details } of orderedResult) {
        if (!useusernames) {
          username = assignees.find(
            (u) => u.key.trim().toLowerCase() === username
          ).displayName;
        }
        username = styles.results.username(username);
        totalDuration += duration;
        let durationStr = styles.results.duration(formatDuration(duration));

        console.log(`${username}${delimiter}${durationStr}`);

        if (detailed) {
          for (let { key, duration } of details) {
            durationStr = styles.results.duration(formatDuration(duration));
            const itemUrl = api.getViewUrlForItem(key);
            key = styles.results.issueKey(key);
            const itemLink = terminalLink(key, itemUrl, {
              fallback: (text, url) => `${text} (${url})`, // terminal-link inserts zero-width whitespace before and after the url. It corrupts links in some terminals
            });

            console.log(`\t${itemLink}${delimiter}${durationStr}`);
          }

          console.log();
        }
      }

      if (!hidetotal) {
        if (!detailed) console.log();
        let totalTitle = styles.results.total.title('Total');
        let totalStr = styles.results.total.duration(
          formatDuration(totalDuration)
        );

        console.log(`${totalTitle}${delimiter}${totalStr}`);
      }

      performance.mark('end');
      performance.measure('total', 'start', 'end');
    }
  );

prog.parse(process.argv);
