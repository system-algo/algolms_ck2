export async function runPythonCode(code, options = {}) {
  const { inputProvider, onOutput, timeoutMs, pageBaseUrl } = options;

  const source = String(code || '');
  const outputLines = [];

  function emit(value) {
    const text = String(value ?? '');
    outputLines.push(text);
    if (typeof onOutput === 'function') {
      onOutput(text);
    }
  }

  try {
    // Load Skulpt dynamically if not present
    if (typeof window.Sk === 'undefined') {
      await loadScript('https://cdn.jsdelivr.net/npm/skulpt@1.2.0/dist/skulpt.min.js');
      await loadScript('https://cdn.jsdelivr.net/npm/skulpt@1.2.0/dist/skulpt-stdlib.js');
    }

    return new Promise((resolve) => {
      // Clear graphics containers if they exist
      const turtleContainer = document.getElementById("turtle-canvas-container");
      if (turtleContainer) {
        turtleContainer.innerHTML = "";
      }

      const hasTurtle = /\bimport\s+turtle\b/.test(source) || /\bfrom\s+turtle\b/.test(source);
      const hasPygame = /\bimport\s+pygame\b/.test(source) || /\bfrom\s+pygame\b/.test(source);

      if (typeof window.Sk !== 'undefined') {
        if (hasTurtle) {
          window.Sk.TurtleGraphics = window.Sk.TurtleGraphics || {};
          window.Sk.TurtleGraphics.target = 'turtle-canvas-container';
          window.Sk.TurtleGraphics.width = 480;
          window.Sk.TurtleGraphics.height = 360;
        }

        if (hasPygame) {
          let canvas = document.getElementById("pygame-canvas");
          if (!canvas && turtleContainer) {
            canvas = document.createElement("canvas");
            canvas.id = "pygame-canvas";
            canvas.width = 500;
            canvas.height = 500;
            canvas.style.maxWidth = "100%";
            canvas.style.height = "auto";
            canvas.style.background = "#000";
            turtleContainer.appendChild(canvas);
          }
          window.Sk.main_canvas = canvas;

          window.Sk.externalLibraries = window.Sk.externalLibraries || {};
          const pygameModules = [
            'pygame', 'pygame.display', 'pygame.draw', 'pygame.event', 
            'pygame.font', 'pygame.image', 'pygame.key', 'pygame.mouse', 
            'pygame.rect', 'pygame.time', 'pygame.transform'
          ];
          for (const mod of pygameModules) {
            const fileName = mod === 'pygame' ? '__init__.js' : mod.split('.')[1] + '.js';
            window.Sk.externalLibraries[mod] = {
              path: `https://cdn.jsdelivr.net/gh/Petlja/pygame4skulpt@master/pygame/${fileName}`
            };
          }
        }
      }

      window.Sk.configure({
        output: function(text) {
          emit(text);
        },
        read: function(x) {
          console.log("[Skulpt Read] Requesting:", x);
          if (window.Sk.builtinFiles !== undefined && window.Sk.builtinFiles["files"][x] !== undefined) {
            return window.Sk.builtinFiles["files"][x];
          }

          // Normalize path by removing "src/lib/" prefix if present
          let cleanPath = x;
          if (cleanPath.startsWith("src/lib/")) {
            cleanPath = cleanPath.substring(8);
          }

          // Map the base pygame import filename to its package entry file
          if (cleanPath === "pygame.js") {
            cleanPath = "pygame/__init__.js";
          }

          const searchPaths = [
            `/${cleanPath}`,
            pageBaseUrl ? `${pageBaseUrl}/${cleanPath}` : null,
            pageBaseUrl ? `${pageBaseUrl}/assets/${cleanPath}` : null,
            `/src/${cleanPath}`,
            `/public/${cleanPath}`,
            `/src/lib/${cleanPath}`
          ].filter(Boolean);

          for (const path of searchPaths) {
            try {
              const xhr = new XMLHttpRequest();
              xhr.open('GET', path, false);
              xhr.send(null);
              console.log(`[Skulpt Read] Path check ${path} -> Status: ${xhr.status}`);
              if (xhr.status === 200) {
                return xhr.responseText;
              }
            } catch (e) {
              console.warn(`[Skulpt Read] Path check ${path} failed with network error:`, e.message);
            }
          }

          // Fallback to CDN for pygame if not found locally
          if (cleanPath.startsWith("pygame/")) {
            const cdnUrl = `https://cdn.jsdelivr.net/gh/Petlja/pygame4skulpt@master/${cleanPath}`;
            console.log(`[Skulpt Read] Attempting CDN fallback: ${cdnUrl}`);
            try {
              const xhr = new XMLHttpRequest();
              xhr.open('GET', cdnUrl, false);
              xhr.send(null);
              console.log(`[Skulpt Read] CDN fallback -> Status: ${xhr.status}`);
              if (xhr.status === 200) {
                return xhr.responseText;
              }
            } catch (e) {
              console.error(`[Skulpt Read] CDN fallback failed with error:`, e.message);
            }
          }

          throw "File not found: '" + x + "'";
        },
        inputfun: function(promptText) {
          const startTime = Date.now();
          const handleResult = (res) => {
            const elapsed = Date.now() - startTime;
            if (window.Sk.execStart) {
              window.Sk.execStart += elapsed;
            }
            return res;
          };

          if (inputProvider) {
            const val = inputProvider(promptText);
            if (val instanceof Promise || (val && typeof val.then === 'function')) {
              return val.then(handleResult);
            }
            return handleResult(val);
          }
          return handleResult(prompt(promptText) || '');
        },
        execLimit: (hasTurtle || hasPygame) ? Number.POSITIVE_INFINITY : (timeoutMs || 10000),
      });

      const myPromise = window.Sk.misceval.asyncToPromise(function() {
        return window.Sk.importMainWithBody("<stdin>", false, source, true);
      });

      myPromise.then(
        function(mod) {
          if (outputLines.length === 0) {
            emit('\n(Program executed successfully, no output)\n');
          }
          resolve({ ok: true, stdout: outputLines.join(''), stderr: '' });
        },
        function(err) {
          resolve({ ok: false, stdout: outputLines.join(''), stderr: err.toString() });
        }
      );
    });
  } catch (error) {
    return {
      ok: false,
      stdout: outputLines.join(''),
      stderr: error?.message || 'Runtime setup error.',
    };
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.crossOrigin = "anonymous";
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}
