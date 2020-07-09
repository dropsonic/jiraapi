const axios = require("axios").default;
const urlJoin = require("url-join");
const endOfLine = require("os").EOL;

class JiraApi {
  constructor(baseUrl, username, password, options) {
    const { logger } = options;

    this.baseUrl = baseUrl;

    const logResponse = (response) => {
      const { config, status, statusText } = response;
      const { baseURL, method } = config;
      const uri = urlJoin(baseURL, axios.getUri(config));
      if (logger)
        logger.debug("HTTP request completed", {
          method: method.toUpperCase(),
          uri,
          status: `${status} ${statusText}`,
        });
    };

    this.api = axios.create({
      baseURL: urlJoin(baseUrl, "/rest/api/latest/"),
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
              throw new BadRequestError(errorMessages.join(endOfLine));
            }
            throw new BadRequestError(
              "The request to JIRA API is invalid. Please contact the administrator."
            );
          case 401:
            throw new InvalidCredentialsError(
              "Invalid credentials. Please check that your username and password are correct."
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

  async searchItems(jqlQuery, expand = { worklog: true, subtasks: false }) {
    const fields = Object.keys(expand)
      .filter((k) => expand[k] === true)
      .join(",");
    const { data } = await this.api.get("/search", {
      params: { jql: jqlQuery, fields },
    });
    return data;
  }

  getViewUrlForItem(key) {
    return urlJoin(this.baseUrl, `/browse/${key}`);
  }
}

class InvalidCredentialsError extends Error {
  constructor(...params) {
    super(...params);

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, InvalidCredentialsError);
    }
  }
}

class AccessDeniedError extends Error {
  constructor(...params) {
    super(...params);

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AccessDeniedError);
    }
  }
}

class BadRequestError extends Error {
  constructor(...params) {
    super(...params);

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AccessDeniedError);
    }
  }
}

module.exports.JiraApi = JiraApi;
module.exports.InvalidCredentialsError = InvalidCredentialsError;
module.exports.AccessDeniedError = AccessDeniedError;
module.exports.BadRequestError = BadRequestError;
