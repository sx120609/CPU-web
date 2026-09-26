// 单独的 MP3 编码器入口：供后台下载对话框按需动态加载。
// 通过静态具名导出保留 tree-shaking，只打包 MP3 编码器（不含 OGG 编码器的内联 wasm）。
export { createMp3Encoder } from 'wasm-media-encoders'
