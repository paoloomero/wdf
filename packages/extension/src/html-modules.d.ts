// esbuild bundles .html imports as text (build.mjs loader); this keeps tsc
// in agreement.
declare module '*.html' {
  const text: string;
  export default text;
}
