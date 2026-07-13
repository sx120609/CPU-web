import { defineEventHandler } from 'h3'
import updateUserHandler from '../[id].put'

export default defineEventHandler(async (event) => {
  return await updateUserHandler(event)
})
