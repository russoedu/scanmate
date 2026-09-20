const { withNx } = require('@nx/rollup/with-nx')

module.exports = withNx(
  {
    main:       './src/index.ts',
    outputPath: './dist',
    tsConfig:   './tsconfig.lib.json',
    // Swapped from swc by MoNecromanCI. @nx/rollup runs swc without
    // sourceMaps, so it returns no map and the bundle's map comes out empty -
    // valid-looking, and useless for debugging. See ROADMAP.
    compiler:   'babel',
    format:     ['esm'],
    // Added by MoNecromanCI: without this rollup emits no .js.map at all, so
    // a breakpoint in a .ts file can never bind. Not published - see `files`.
    sourceMap:  true,
  },
  {
    // Added by MoNecromanCI. rollup hands sourcemapPathTransform an OS-NATIVE
    // path with one parent segment too many, so `sources` resolve to nothing
    // and no breakpoint can bind. Separators are normalised too: a sources
    // entry is URL-style, so a backslash is wrong on every platform.
    output: {
      sourcemapPathTransform: relativeSourcePath =>
        relativeSourcePath
          .replaceAll(String.fromCodePoint(92), '/')
          .replace(/^(\.\.\/)+/, '../'),
    },
    // Added by MoNecromanCI. @nx/rollup's dts-bundle plugin writes dist/index.d.ts
    // as a stub re-exporting the real declarations, and builds that specifier with
    // path.relative() - an OS-NATIVE path. On Windows it emits
    //   export * from "./src\\index";
    // which is not a valid module specifier on ANY platform: a specifier is
    // URL-style, so / is correct everywhere and a backslash nowhere. It resolves on
    // Windows only because the resolver normalises separators there, leaving the
    // package untyped on Linux and macOS.
    //
    // mnci also points `types` past this stub, so nothing depends on it being
    // correct; this makes the emitted file correct too. Remove once Nx fixes the
    // plugin - its own devkit already exports normalizePath for exactly this.
    //
    // The second half fixes a separate defect in the REAL declarations `types`
    // points at: tsconfig.lib.json declares under moduleResolution "bundler",
    // where a bare relative specifier ("./lib/align") is valid, so every emitted
    // .d.ts keeps the source's own extensionless imports verbatim. A consumer on
    // "moduleResolution": "nodenext" - the workspace root default - requires an
    // explicit extension on every relative specifier and gets TS2834 (or,
    // combined with skipLibCheck, a silent zero-export module) instead. Declared
    // extensions are left untouched; only a bare relative specifier gets .js
    // appended, matching what tsc itself emits under node16/nodenext.
    plugins: [
      {
        name: 'mnci-normalise-declaration-specifiers',
        writeBundle (outputOptions) {
          const { readdirSync, readFileSync, writeFileSync } = require('node:fs')
          const { join } = require('node:path')
          const dir = outputOptions.dir ?? './dist'
          const stub = join(dir, 'index.d.ts')
          let source
          try {
            source = readFileSync(stub, 'utf8')
          } catch {
            return
          }
          // The stub carries a TWO-character escape (JSON.stringify escaped one
          // backslash), so this must not match a single one - that would turn
          // "./src\index" into "./src//index". Built from char codes so there is
          // no escaping in this file to get wrong.
          const separator = String.fromCodePoint(92, 92)
          const normalised = source.replaceAll(separator, '/')
          if (normalised !== source) writeFileSync(stub, normalised)

          const bareRelativeSpecifier = /from(\s+)(['"])(\.[^'"]+)\2/g
          const hasExtension = /\.(?:mjs|cjs|jsx?|json)$/
          let entries
          try {
            entries = readdirSync(dir, { recursive: true, withFileTypes: true })
          } catch {
            return
          }
          for (const entry of entries) {
            if (!entry.name.endsWith('.d.ts')) continue
            const filePath = join(entry.parentPath ?? entry.path, entry.name)
            let declaration
            try {
              declaration = readFileSync(filePath, 'utf8')
            } catch {
              continue
            }
            const withExtensions = declaration.replaceAll(
              bareRelativeSpecifier,
              (match, space, quote, specifier) =>
                hasExtension.test(specifier) ? match : `from${space}${quote}${specifier}.js${quote}`,
            )
            if (withExtensions !== declaration) writeFileSync(filePath, withExtensions)
          }
        },
      },
    ],
  },
)
