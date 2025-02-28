import { type Static, Type } from '@sinclair/typebox'
import { type FastifyPluginAsync } from 'fastify'
import { addGameServer, getGameServer } from '~gameservers/index.js'

// POST /server/heartbeat
// refreshes a gameserver's last heartbeat time, gameservers are removed after 30 seconds without a heartbeat

const register: FastifyPluginAsync = async (fastify, _) => {
  const HeartbeatQuery = Type.Object({
    // The id of the server sending this message
    id: Type.String(),
    playerCount: Type.Integer({ minimum: 0 }),
  })

  fastify.post<{ Querystring: Static<typeof HeartbeatQuery> }>(
    '/server/heartbeat',
    {
      schema: {
        querystring: HeartbeatQuery,
      },
    },
    async request => {
      const server = await getGameServer(request.query.id)
      if (!server || request.ip !== server.ip) {
        return null
      }

      server.lastHeartbeat = Date.now()
      server.playerCount = request.query.playerCount

      // Set server in storage
      await addGameServer(server)
      return null
    }
  )
}

export default register
