import { getRequestListener } from '@hono/node-server'
import { app } from './runtime.js'

export default getRequestListener(app.fetch)
