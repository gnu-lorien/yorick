// htm bound to React.createElement
// ================================
//
// This is the one piece of scaffolding the no-build-step constraint forces.
//
// htm is a tagged template literal that produces React elements at runtime.
// It exists here so the component modules can be written in something that
// reads like JSX without putting a compiler in front of a codebase that has
// never had one. Every `html\`<div/>\`` below is exactly the JSX you would
// write after a bundler was added, minus the compile step.
//
// If this app is ported for real, this module is the *only* file that gets
// deleted: swap `html\`...\`` for JSX, point Vite at it, and the components
// are unchanged.

define([
    "react",
    "htm"
], function (React, htm) {
    return htm.bind(React.createElement);
});
