import { type FastifyPluginCallback } from "fastify"
import axios from "axios"

const path = require( "path" )
const crypto = require( "crypto" )
const { GameServer, GetGameServers } = require( "../../shared/gameserver.js" )
const accounts = require( "../../shared/accounts.js" )

let shouldRequireSessionToken = process.env.REQUIRE_SESSION_TOKEN = true

const register: FastifyPluginCallback = (fastify, opts, done) => {
	// exported routes

	// POST /client/origin_auth
	// used to authenticate a user on northstar, so we know the person using their uid is really them
	// returns the user's northstar session token
	fastify.get( '/client/origin_auth',
	{
		schema: {
			querystring: {
				id: { type: "string" }, // the authing player's id
				token: { type: "string" } // the authing player's origin token
			}
		}
	},
	async ( request, reply ) => {
		// only do this if we're in an environment that actually requires session tokens
		if ( shouldRequireSessionToken )
		{
			// todo: we should find origin endpoints that can verify game tokens so we don't have to rely on stryder for this in case of a ratelimit
			if ( request.query.token.includes( "&" ) )
				return { success: false }

			const params = new URLSearchParams()
			params.set('qt', 'origin-requesttoken')
			params.set('type', 'server_token')
			params.set('code', request.query.token)
			params.set('forceTrial', '0')
			params.set('proto', '0')
			params.set('json', '1')
			params.set('env', 'production')
			params.set('userId', parseInt(request.query.id).toString(16).toUpperCase())

			// TODO: Handle errors
			let { data: authJson } = await axios.get('https://r2-pc.stryder.respawn.com/nucleus-oauth.php', { params })

			// check origin auth was fine
			// unsure if we can check the exact value of storeUri? doing an includes check just in case
			if ( authJson.hasOnlineAccess != "1" /* this is actually a string of either "1" or "0" */ || !authJson.storeUri.includes( "titanfall-2" ) )
				return { success: false }
		}

		let account = await accounts.AsyncGetPlayerByID( request.query.id )
		if ( !account ) // create account for user
		{
			await accounts.AsyncCreateAccountForID( request.query.id )
			account = await accounts.AsyncGetPlayerByID( request.query.id )
		}

		let authToken = crypto.randomBytes( 16 ).toString( "hex" )
		accounts.AsyncUpdateCurrentPlayerAuthToken( account.id, authToken )

		return {
			success: true,
			token: authToken
		}
	})

	// POST /client/auth_with_server
	// attempts to authenticate a client with a gameserver, so they can connect
	// authentication includes giving them a 1-time token to join the gameserver, as well as sending their persistent data to the gameserver
	fastify.post( '/client/auth_with_server',
	{
		schema: {
			querystring: {
				id: { type: "string" }, // id of the player trying to auth
				playerToken: { type: "string" }, // not implemented yet: the authing player's account token
				server: { type: "string" },
				password: { type: "string" } // the password the player is using to connect to the server
			}
		}
	},
	async ( request, reply ) => {
		let server = GetGameServers()[ request.query.server ]

		if ( !server || ( server.hasPassword && request.query.password != server.password ) )
			return { success: false }

		let account = await accounts.AsyncGetPlayerByID( request.query.id )
		if ( !account )
			return { success: false }

		if ( shouldRequireSessionToken )
		{
			// check token
			if ( request.query.playerToken != account.currentAuthToken )
				return { success: false }

			// check expired token
			if ( account.currentAuthTokenExpirationTime < Date.now() )
				return { success: false }
		}

		// fix this: game doesnt seem to set serverFilter right if it's >31 chars long, so restrict it to 31
		let authToken = crypto.randomBytes( 16 ).toString( "hex" ).substr( 0, 31 )

		// todo: build persistent data here, rather than sending baseline only
		let pdata = await accounts.AsyncGetPlayerPersistenceBufferForMods( request.query.id, server.modInfo.Mods.filter( m => !!m.pdiff ).map( m => m.pdiff ) )

		let authResponse = await asyncHttp.request( {
			method: "POST",
			host: server.ip,
			port: server.authPort,
			path: `/authenticate_incoming_player?id=${request.query.id}&authToken=${authToken}&serverAuthToken=${server.serverAuthToken}`
		}, pdata )

		if ( !authResponse )
			return { success: false }

		let jsonResponse = JSON.parse( authResponse.toString() )
		if ( !jsonResponse.success )
			return { success: false }

		return {
			success: true,

			ip: server.ip,
			port: server.port,
			authToken: authToken
		}
	})

	// POST /client/auth_with_self
	// attempts to authenticate a client with their own server, before the server is created
	// note: atm, this just sends pdata to clients and doesn't do any kind of auth stuff, potentially rewrite later
	fastify.post( '/client/auth_with_self',
	{
		schema: {
			querystring: {
				id: { type: "string" }, // id of the player trying to auth
				playerToken: { type: "string" }, // not implemented yet: the authing player's account token
			}
		}
	},
	async ( request, reply ) => {
		let account = await accounts.AsyncGetPlayerByID( request.query.id )
		if ( !account )
			return { success: false }

		if ( shouldRequireSessionToken )
		{
			// check token
			if ( request.query.playerToken != account.currentAuthToken )
				return { success: false }

			// check expired token
			if ( account.currentAuthTokenExpirationTime < Date.now() )
				return { success: false }
		}

		// fix this: game doesnt seem to set serverFilter right if it's >31 chars long, so restrict it to 31
		let authToken = crypto.randomBytes( 16 ).toString("hex").substr( 0, 31 )
		accounts.AsyncUpdatePlayerCurrentServer( account.id, "self" ) // bit of a hack: use the "self" id for local servers

		return {
			success: true,

			id: account.id,
			authToken: authToken,
			// this fucking sucks, but i couldn't get game to behave if i sent it as an ascii string, so using this for now
			persistentData: Array.from( new Uint8Array( account.persistentDataBaseline ) )
		}
	})

	done()
}

export default register