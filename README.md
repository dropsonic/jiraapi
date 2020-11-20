# @acumatica/jiraapi

[![npm version](https://img.shields.io/npm/v/@acumatica/jiraapi.svg?style=flat-square)](https://www.npmjs.org/package/@acumatica/jiraapi)

A set of helper tools to work with JIRA REST API to collect, aggregate & process the data that cannot be retrieved directly from the UI.

## Installing

```bash
npm install -g @acumatica/jiraapi
```

After installing it, run `jiraapi --help` without arguments to see the list of commands available.

On Windows, please make sure that you have `%APPDATA\Roaming\npm` in your PATH environment variable.

On the first execution of any command, the tool will ask you for your JIRA credentials. After that, they will be securely stored on your computer using the default credentials manager on your OS.
This tool uses Basic Authentication in JIRA REST API.

You can use both usernames (`jsmith`) or full names (`Josh Smith`) in the list of assignees. If there are multiple users found by the full name provided, the tool will ask you which one should be used. It is OK to make typos in the user's full name, the tool uses JIRA search to find the appropriate assignee.

## Example

### Getting an aggregated worklog for a predefined item category

```bash
jiraapi worklog -a "Josh Smith, Maxwell Baker, John Deer, Alexa Bloom" -t "2020 Q2" --itemtype SupportRequests
```

Output:

```bash
Alexa Bloom     73.79d
John Deer       54.09d
Josh Smith      30.89d
Maxwell Baker   47.87d

Total           206.64d
```

```bash
jiraapi worklog -a "jsmith, maxwell.baker, john.deer, alexa.bloom" -t "2019 Q4" --itemtype ExternalBugs
```

Output:

```bash
alexa.bloom     73.79d
john.deer       54.09d
jsmith          30.89d
maxwell.baker   47.87d

Total           206.64d
```

### Getting an aggregated worklog using a custom JQL query

```bash
jiraapi worklog -a "John Smith, Maxwell Baker, John Deer, Alexa Bloom" -t "2019 Q4" -q "Project = PI AND Status not in (Resolved, Closed)"
```

### Getting a detailed worklog

```bash
jiraapi worklog -a "Josh Smith, Alexa Bloom" -t "2019-12" --detailed
```

Output:

```bash
Alexa Bloom 2.82d
    DEV-1922 (https://jira.mydomain.com/browse/DEV-1922) 1.76d
    DEV-1378 (https://jira.mydomain.com/browse/DEV-1378) 1.06d

Josh Smith  7.93d
    PI-223 (https://jira.mydomain.com/browse/PI-223) 3.46d
    QA-8842 (https://jira.mydomain.com/browse/QA-8842) 2.29d
    DEV-1922 (https://jira.mydomain.com/browse/DEV-1922) 2.18d

Total       12.23d
```

If you have a terminal that supports embedded hyperlinks (e.g., [Windows Terminal](https://docs.microsoft.com/en-us/windows/terminal/) v1.4 and higher), the output will look like this:

<pre>
Alexa Bloom  2.82d
    <a href="https://jira.mydomain.com/browse/DEV-1922">DEV-1922</a> 1.76d
    <a href="https://jira.mydomain.com/browse/DEV-1378">DEV-1378</a> 1.06d<br/>
Josh Smith   7.93d
    <a href="https://jira.mydomain.com/browse/PI-223">PI-223</a>   3.46d
    <a href="https://jira.mydomain.com/browse/QA-8842">QA-8842</a>  2.29d
    <a href="https://jira.mydomain.com/browse/DEV-1922">DEV-1922</a> 2.18d<br/>
Total        12.23d
</pre>

### Getting a human-readable output for large amounts of time

```bash
jiraapi worklog -a "John Smith, Maxwell Baker, John Deer, Alexa Bloom, Nick Daniels" -t "2020 Q2" --humanize
```

Output:

```bash
Alexa Bloom     2 months, 2 weeks, 3 days, 2 hours, 46 minutes
John Deer       1 month, 2 weeks, 5 hours, 3 minutes
Josh Smith      3 months, 2 weeks, 2 days, 3 hours, 27 minutes
Maxwell Baker   2 months, 2 weeks, 4 days, 4 hours, 2 minutes
Nick Daniels    2 months, 1 week, 1 day, 5 hours, 48 minutes

Total           1 year, 3 weeks, 4 hours, 30 minutes
```
