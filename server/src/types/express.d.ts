import type { JwtPayload } from "../utils/jwt";
import type { BrowserSession } from "../services/browserSession";

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
      browserSessionId?: string;
      browserSession?: BrowserSession;
      /** The session cookie's record could not be read (store failure): signed in or not is unknown. */
      browserSessionUnavailable?: boolean;
    }
  }
}
export {};
