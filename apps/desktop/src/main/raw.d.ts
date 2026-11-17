/** `import text from "./file?raw"`: Vite bundles the file's text as a string (setup/fixes.ts). */
declare module "*?raw" {
  const text: string;
  export default text;
}
