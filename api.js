import axios from 'axios';
import urlJoin from 'url-join';
import { EOL } from 'os';

export class JiraApi {
  constructor(baseUrl, username, password, options) {
    const { logger } = options;

    this.baseUrl = baseUrl;

    const logResponse = (response) => {
      const { config, status, statusText } = response;
      const { baseURL, method } = config;
      const uri = urlJoin(baseURL, axios.getUri(config));
      if (logger)
        logger.debug('HTTP request completed', {
          method: method.toUpperCase(),
          uri,
          status: `${status} ${statusText}`,
        });
    };

    this.api = axios.create({
      baseURL: urlJoin(baseUrl, '/rest/api/latest/'),
      auth: { username, password },
      params: {
        maxResults: 10000,
      },
    });

    this.api.interceptors.response.use(
      (response) => {
        logResponse(response);
        return response;
      },
      (error) => {
        logResponse(error.response);

        switch (error.response.status) {
          case 400:
            const { errorMessages } = error.response.data;
            if (errorMessages && errorMessages.length > 0) {
              throw new BadRequestError(errorMessages.join(EOL));
            }
            throw new BadRequestError(
              'The request to JIRA API is invalid. Please contact the administrator.'
            );
          case 401:
            throw new InvalidCredentialsError(
              'Invalid credentials. Please check that your username and password are correct.'
            );
          case 403:
            throw new AccessDeniedError(
              "You do not have access to the entities you're querying. Please contact the JIRA administrator or try another credentials."
            );
          default:
            return Promise.reject(error);
        }
      }
    );

    // TODO: remove after upgrading axios to 0.20.0
    // https://github.com/axios/axios/issues/2190
    this.api.interceptors.request.use((config) => {
      if (!config.params) config.params = {};
      config.params.maxResults = 10000;
      return config;
    });
  }

  get credentials() {
    return this.api.defaults.auth;
  }

  set credentials(value) {
    this.api.defaults.auth = value;
  }

  async getItemByKey(key) {
    const { data } = await this.api.get(`/issue/${key}`);
    return data;
  }

  async getWorklogByItemKey(key) {
    const { data } = await this.api.get(`/issue/${key}/worklog`);
    return data;
  }

  /**
   *
   * @param {string} jqlQuery - JQL query to perform the search
   * @param {Object} [expand] Expansion settings for the query
   * @param {boolean} [expand.worklog=true] Include the worklog items for each JIRA item
   * @param {boolean} [expand.subtasks=false] Include the list of subtasks for each JIRA item
   */
  async searchItems(jqlQuery, { worklog = true, subtasks = false } = {}) {
    const expand = { worklog, subtasks };
    const fields = Object.keys(expand)
      .filter((k) => expand[k] === true)
      .join(',');
    const params = { fields };
    if (jqlQuery) params.jql = jqlQuery;
    const { data } = await this.api.get('/search', { params });
    return data;
  }

  getViewUrlForItem(key) {
    return urlJoin(this.baseUrl, `/browse/${key}`);
  }

  async searchUsers(searchQuery) {
    const { data } = await this.api.get('/user/search', {
      params: { username: searchQuery, includeInactive: true },
    });
    return data;
  }
}

export class InvalidCredentialsError extends Error {
  constructor(...params) {
    super(...params);

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, InvalidCredentialsError);
    }
  }
}

export class AccessDeniedError extends Error {
  constructor(...params) {
    super(...params);

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AccessDeniedError);
    }
  }
}

export class BadRequestError extends Error {
  constructor(...params) {
    super(...params);

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AccessDeniedError);
    }
  }
}
