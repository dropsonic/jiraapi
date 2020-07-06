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

## Example

### Getting an aggregated worklog for a predefined item category

```bash
jiraapi worklog -a "jsmith, maxwell.baker, john.deer, alexa.bloom" -t "2020 Q2" --itemtype SupportRequests
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
jiraapi worklog -a "jsmith, maxwell.baker, john.deer, alexa.bloom" -t "2019 Q4" -q "Project = PI AND Status not in (Resolved, Closed)"
```

### Getting a detailed worklog

```bash
jiraapi worklog -a "jsmith, alexa.bloom" -t "2019-12" --detailed
```

Output:

```bash
alexa.bloom 2.82d
    DEV-1922 (https://jira.mydomain.com/browse/DEV-1922) 1.76d
    DEV-1378 (https://jira.mydomain.com/browse/DEV-1378) 1.06d

jsmith      7.93d
    PI-223 (https://jira.mydomain.com/browse/PI-223) 3.46d
    QA-8842 (https://jira.mydomain.com/browse/QA-8842) 2.29d
    DEV-1922 (https://jira.mydomain.com/browse/DEV-1922) 2.18d

Total       12.23d
```

### Getting a human-readable output for large amounts of time

```bash
jiraapi worklog -a "jsmith, maxwell.baker, john.deer, alexa.bloom, ndaniels" -t "2020 Q2" --humanize
```

Output:

```bash
alexa.bloom     2 months, 2 weeks, 3 days, 2 hours, 46 minutes
john.deer       1 month, 2 weeks, 5 hours, 3 minutes
jsmith          3 months, 2 weeks, 2 days, 3 hours, 27 minutes
maxwell.baker   2 months, 2 weeks, 4 days, 4 hours, 2 minutes
ndaninels       2 months, 1 week, 1 day, 5 hours, 48 minutes

Total           1 year, 3 weeks, 4 hours, 30 minutes
```
