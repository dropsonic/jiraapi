const axios = require('axios').default;

class JiraApi {
	constructor(baseUrl, username, password) {
		this.api = axios.create({
			baseURL: baseUrl.toString(),
			auth: {
				username: username,
				password: password
			},
			params: {
				maxResults: 10000
			}
		});

		// TODO: remove after upgrading axios to 0.20.0
		// https://github.com/axios/axios/issues/2190
		this.api.interceptors.request.use((config) => {
			if (!config.params) config.params = {};
			config.params.maxResults = 10000;
			return config;
		});
	}

	async getItemByKey(key) {
		const { data } = await this.api.get(`/issue/${key}`);
		return data;
	}

	async getWorklogByItemKey(key) {
		const { data } = await this.api.get(`/issue/${key}/worklog`);
		return data;
	}

	async searchItems(jqlQuery) {
		const { data } = await this.api.get('/search', { params: { jql: jqlQuery, fields: 'worklog' } });
		return data;
	}
}

module.exports.JiraApi = JiraApi;
