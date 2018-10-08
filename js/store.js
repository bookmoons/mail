import Vue from 'vue'
import Vuex from 'vuex'

import {
	fetch as fetchAccount,
	fetchAll as fetchAllAccounts,
	createAccount,
} from './service/AccountService'
import { fetchAll as fetchAllFolders } from './service/FolderService'
import {
	fetchEnvelopes,
	syncEnvelopes,
	setEnvelopeFlag,
	fetchMessage,
} from './service/MessageService'

Vue.use(Vuex)

export const mutations = {
	addAccount(state, account) {
		account.folders = []
		Vue.set(state.accounts, account.id, account)
	},
	addFolder(state, { account, folder }) {
		let id = account.id + '-' + folder.id
		folder.envelopes = []
		Vue.set(state.folders, id, folder)
		account.folders.push(id)
	},
	updateFolderSyncToken(state, { folder, syncToken }) {
		folder.syncToken = syncToken
	},
	addEnvelope(state, { accountId, folder, envelope }) {
		let id = accountId + '-' + folder.id + '-' + envelope.id
		Vue.set(state.envelopes, id, envelope)
		// TODO: prepend/append sort magic
		// TODO: reduce O(n) complexity
		if (folder.envelopes.indexOf(id) === -1) {
			// Prevent duplicates
			folder.envelopes.push(id)
		}
	},
	flagEnvelope(state, { accountId, folderId, id, flag, value }) {
		state.envelopes[accountId + '-' + folderId + '-' + id].flags[
			flag
		] = value
	},
	removeEnvelope(state, { accountId, folder, envelope }) {
		folder.envelopes = folder.envelopes.filter(
			existing => existing.id !== envelope.id
		)
	},
	addMessage(state, { accountId, folderId, message }) {
		Vue.set(
			state.messages,
			accountId + '-' + folderId + '-' + message.id,
			message
		)
	},
	setLoading(state, loadingStatus) {
		state.loading = loadingStatus
	},
}

export const actions = {
	fetchAccounts({ commit }) {
		return fetchAllAccounts().then(accounts => {
			accounts.forEach(account => commit('addAccount', account))
			return accounts
		})
	},
	fetchAccount({ commit }, id) {
		return fetchAccount(id).then(account => {
			commit('addAccount', account)
			return account
		})
	},
	fetchFolders({ commit, getters }, { accountId }) {
		return fetchAllFolders(accountId).then(folders => {
			let account = getters.getAccount(accountId)

			folders.forEach(folder => {
				commit('addFolder', {
					account,
					folder,
				})
			})
			return folders
		})
	},
	fetchEnvelopes({ commit, getters }, { accountId, folderId }) {
		return fetchEnvelopes(accountId, folderId).then(envs => {
			let folder = getters.getFolder(accountId, folderId)

			envs.forEach(envelope =>
				commit('addEnvelope', {
					accountId,
					folder,
					envelope,
				})
			)
			return envs
		})
	},
	fetchNextEnvelopePage({ commit, getters }, { accountId, folderId }) {
		const folder = getters.getFolder(accountId, folderId)
		const lastEnvelopeId = folder.envelopes[folder.envelopes.length - 1]
		if (typeof lastEnvelopeId === 'undefined') {
			console.error('folder is empty', folder.envelopes)
			return Promise.reject(
				new Error(
					'Local folder has no envelopes, cannot determine cursor'
				)
			)
		}
		const lastEnvelope = getters.getEnvelopeById(lastEnvelopeId)
		if (typeof lastEnvelope === 'undefined') {
			return Promise.reject(
				new Error(
					'Cannot find last envelope. Required for the folder cursor'
				)
			)
		}

		console.debug(
			'loading next envelope page, cursor=' + lastEnvelope.dateInt
		)

		return fetchEnvelopes(accountId, folderId, lastEnvelope.dateInt).then(
			envs => {
				console.debug('page loaded, size=' + envs.length)

				envs.forEach(envelope =>
					commit('addEnvelope', {
						accountId,
						folder,
						envelope,
					})
				)

				return envs
			}
		)
	},
	syncEnvelopes({ commit, getters }, { accountId, folderId }) {
		const folder = getters.getFolder(accountId, folderId)
		const syncToken = folder.syncToken
		const uids = getters
			.getEnvelopes(accountId, folderId)
			.map(env => env.id)

		return syncEnvelopes(accountId, folderId, syncToken, uids).then(
			syncData => {
				console.debug('got sync response:', syncData)
				syncData.newMessages
					.concat(syncData.changedMessages)
					.forEach(envelope => {
						commit('addEnvelope', {
							accountId,
							folder,
							envelope,
						})
					})
				syncData.vanishedMessages.forEach(envelope => {
					commit('removeEnvelope', {
						accountId,
						folder,
						envelope,
					})
				})
				commit('updateFolderSyncToken', {
					folder,
					syncToken: syncData.token,
				})
			}
		)
	},
	toggleEnvelopeFlagged({ commit, getters }, { accountId, folderId, id }) {
		// Change immediately and switch back on error
		const oldState = getters.getEnvelope(accountId, folderId, id).flags
			.flagged
		commit('flagEnvelope', {
			accountId,
			folderId,
			id,
			flag: 'flagged',
			value: !oldState,
		})

		setEnvelopeFlag(accountId, folderId, id, 'flagged', !oldState).catch(
			e => {
				console.error('could not toggle message flagged state', e)

				// Revert change
				commit('flagEnvelope', {
					accountId,
					folderId,
					id,
					flag: 'flagged',
					value: oldState,
				})
			}
		)
	},
	toggleEnvelopeSeen({ commit, getters }, { accountId, folderId, id }) {
		// Change immediately and switch back on error
		const oldState = getters.getEnvelope(accountId, folderId, id).flags
			.unseen
		commit('flagEnvelope', {
			accountId,
			folderId,
			id,
			flag: 'unseen',
			value: !oldState,
		})

		setEnvelopeFlag(accountId, folderId, id, 'unseen', !oldState).catch(
			e => {
				console.error('could not toggle message unseen state', e)

				// Revert change
				commit('flagEnvelope', {
					accountId,
					folderId,
					id,
					flag: 'unseen',
					value: oldState,
				})
			}
		)
	},
	fetchMessage({ commit }, { accountId, folderId, id }) {
		return fetchMessage(accountId, folderId, id).then(message => {
			commit('addMessage', {
				accountId,
				folderId,
				message,
			})
			return message
		})
	},
	requestCreateAccount({ commit, getters }, config) {
		commit('setLoading', true)
		return createAccount(config).then(
			resp => {
				commit('setLoading', false)
				console.log('response', resp)
				resp.data
			},
			error => {
				commit('setLoading', false)
				console.log('Error', error)
				if (error.response) {
					console.log(error.response.data)
					console.log(error.response.status)

					const errorMsg =
						error.response.data.message ||
						t('mail', 'Unknown error')
					return Promise.reject(
						t(
							'mail',
							`Error while creating the account: ${errorMsg}`
						)
					)
				} else if (error.request) {
					// The request was made but no response was received
					// `error.request` is an instance of XMLHttpRequest
					console.log(error.request)
				} else {
					// Something happened in setting up the request that triggered an Error
					console.log('Error', error.message)
				}
			}
		)
	},
}

export const getters = {
	getAccount: state => id => {
		return state.accounts[id]
	},
	getAccounts: state => () => {
		return state.accounts
	},
	getFolder: state => (accountId, folderId) => {
		return state.folders[accountId + '-' + folderId]
	},
	getFolders: state => accountId => {
		return state.accounts[accountId].folders.map(
			folderId => state.folders[folderId]
		)
	},
	getEnvelope: state => (accountId, folderId, id) => {
		return state.envelopes[accountId + '-' + folderId + '-' + id]
	},
	getEnvelopeById: state => id => {
		return state.envelopes[id]
	},
	getEnvelopes: (state, getters) => (accountId, folderId) => {
		return getters
			.getFolder(accountId, folderId)
			.envelopes.map(msgId => state.envelopes[msgId])
	},
	getMessage: state => (accountId, folderId, id) => {
		return state.messages[accountId + '-' + folderId + '-' + id]
	},
}

export default new Vuex.Store({
	strict: process.env.NODE_ENV !== 'production',
	state: {
		accounts: {},
		folders: {},
		envelopes: {},
		messages: {},
		loading: false,
	},
	getters,
	mutations,
	actions,
})
