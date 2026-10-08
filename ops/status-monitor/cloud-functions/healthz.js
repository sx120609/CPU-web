import { handle } from '../eo/runtime.mjs';
export function onRequest(context) { return handle(context, 'health'); }
