export interface Campus3DOptions {
  emblemUrl: string;
  calliUrl: string;
  data: unknown;
  outer: unknown;
}
export function mountCampus3D(root: ShadowRoot, opts: Campus3DOptions): () => void;
