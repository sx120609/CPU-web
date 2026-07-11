import type { JwtPayload } from "../utils/jwt";
import type { BrowserSession } from "../services/browserSession";

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
      browserSessionId?: string;
      browserSession?: BrowserSession;
    }
  }
}
export {};
