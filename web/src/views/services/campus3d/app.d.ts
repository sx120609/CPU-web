export interface Campus3DOptions {
  emblemUrl: string;
  calliUrl: string;
  data: unknown;
  outer: unknown;
  presence?: {
    join(): Promise<{ sid: string; key: string; pid: string; name: string }>;
    sync(body: { sid: string; key: string; s: number[]; h?: boolean }): Promise<{ t: number; n: number; p: Array<[string, string, number, number, number, number, number, number, number]> }>;
    leave(body: { sid: string; key: string }): unknown;
  } | null;
}
export function mountCampus3D(root: ShadowRoot, opts: Campus3DOptions): () => void;
