import { defineEventHandler } from 'h3'
import deleteUserHandler from '../[id].delete'

export default defineEventHandler(async (event) => {
  return await deleteUserHandler(event)
})
