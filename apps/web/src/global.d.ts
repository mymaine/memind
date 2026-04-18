// Ambient declaration for CSS side-effect imports (e.g.
// `import './glyph-animations.css'`). Next.js handles the bundling at build
// time; this tells the editor's TypeScript language server that the specifier
// is a valid module so it stops flagging it as an error 2882.
declare module '*.css';
