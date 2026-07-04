/**
 * Identicon - Generative identity art for Clout
 *
 * Ported from hypermind-swarm's banner-generator.js. Produces deterministic
 * SVG fractals (a constellation of nodes connected by proximity lines) from a
 * public key hash. Every identity gets a unique, recognizable visual signature
 * without any uploaded image — censorship-resistant and on-mission for a
 * cryptographic-identity protocol.
 *
 * The fractal's primary hue is derived from the public key hash (for
 * uniqueness); accent colors draw from Clout's hop-distance palette
 * (--hop-1/2/3, --primary, --secondary, --accent) so identicons stay
 * on-brand.
 *
 * Pure SVG generation — no external dependencies, no network calls.
 */

/**
 * djb2 hash — fast, deterministic, good distribution for short strings.
 * @param {string} str
 * @returns {number} 32-bit signed integer
 */
function _djb2(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
  }
  return hash;
}

/**
 * Clout's on-brand accent palette, drawn from the hop-distance design tokens
 * declared in base.css. Used to pick a per-identity accent color so
 * identicons feel native to Clout's visual system.
 */
const ACCENT_COLORS = [
  'var(--hop-1)',   // green  — direct trust
  'var(--hop-2)',   // yellow — friends of friends
  'var(--hop-3)',   // orange — extended network
  'var(--primary)', // indigo
  'var(--secondary)',// violet
  'var(--accent)',  // cyan
  'var(--success)', // green
];

/**
 * Pick a CSS-variable accent color for an identity, deterministically from
 * its public key. Mirrors hypermind-swarm's getAvatarBgVar but uses Clout's
 * palette.
 * @param {string} pubkey
 * @returns {string} a CSS color (var(--...))
 */
export function getAvatarColorVar(pubkey) {
  if (!pubkey) return ACCENT_COLORS[0];
  return ACCENT_COLORS[Math.abs(_djb2(pubkey)) % ACCENT_COLORS.length];
}

/**
 * Generate the raw SVG markup for an identity fractal.
 *
 * ~45 nodes are scattered across the viewBox; pairs within a proximity
 * threshold are connected by lines whose opacity falls off with distance,
 * producing a neural-network / constellation look. The hue is derived from
 * the public key hash so every identity is visually unique.
 *
 * @param {string} pubkey - the author's public key (typically 64 hex chars)
 * @param {object} [opts]
 * @param {number} [opts.width=400]   - SVG viewBox width
 * @param {number} [opts.height=100]  - SVG viewBox height
 * @param {number} [opts.nodeCount=45]- number of nodes to scatter
 * @returns {string} raw SVG markup (empty string if pubkey is falsy)
 */
export function getFractalSvg(pubkey, { width = 400, height = 100, nodeCount = 45 } = {}) {
  if (!pubkey) return '';

  const seed = _djb2(pubkey);
  let cur = seed;
  // Deterministic PRNG seeded by the pubkey hash. Math.sin-based LCG is
  // what hypermind-swarm uses; good enough for visual variety and cheap.
  const rnd = () => {
    const x = Math.sin(cur++) * 10000;
    return x - Math.floor(x);
  };

  // Two hues offset by 40° — bg is dark/muted, synapse is bright.
  const h1 = Math.abs(_djb2(pubkey)) % 360;
  const h2 = (h1 + 40) % 360;
  const bg = `hsl(${h1}, 25%, 22%)`;
  const synapse = `hsl(${h2}, 75%, 72%)`;

  const nodes = [];
  for (let i = 0; i < nodeCount; i++) {
    nodes.push({
      x: rnd() * width,
      y: rnd() * height,
      r: 0.5 + rnd() * 1.0,
    });
  }

  // Connect near neighbors. Threshold scales with the smaller viewBox dim
  // so the fractal looks right at any aspect ratio.
  const maxDist = Math.min(width, height) * 0.3;
  const lines = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[i].x - nodes[j].x;
      const dy = nodes[i].y - nodes[j].y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < maxDist) {
        const o = (1 - d / maxDist) * 0.6;
        lines.push(
          `<line x1="${nodes[i].x.toFixed(1)}" y1="${nodes[i].y.toFixed(1)}"` +
          ` x2="${nodes[j].x.toFixed(1)}" y2="${nodes[j].y.toFixed(1)}"` +
          ` stroke="${synapse}" stroke-width="0.3" stroke-opacity="${o.toFixed(2)}"/>`
        );
      }
    }
  }

  const dots = nodes.map(n =>
    `<circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${n.r.toFixed(2)}"` +
    ` fill="${synapse}" fill-opacity="0.8"/>`
  );

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"` +
    ` preserveAspectRatio="xMidYMid slice">` +
    `<rect width="${width}" height="${height}" fill="${bg}" fill-opacity="0.45"/>` +
    `${lines.join('')}${dots.join('')}` +
    `</svg>`.replace(/\s+/g, ' ').trim();

  return svg;
}

/**
 * Generate a fractal identicon as a `data:image/svg+xml` URL suitable for
 * use as a CSS `background-image`.
 *
 * @param {string} pubkey
 * @param {object} [opts] - forwarded to getFractalSvg
 * @returns {string} data URL (empty string if pubkey is falsy)
 */
export function getFractalDataUrl(pubkey, opts) {
  const svg = getFractalSvg(pubkey, opts);
  if (!svg) return '';
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * A CSS gradient derived from the pubkey hash — a lighter-weight
 * alternative to the full fractal SVG, for contexts where a background
 * image is undesirable (e.g. tiny inline avatars). Layers a directional
 * hue gradient with a radial accent glow from Clout's palette.
 *
 * @param {string} pubkey
 * @returns {string} a CSS `background` value
 */
export function getAvatarGradient(pubkey) {
  if (!pubkey) return 'var(--bg-hover)';
  const hash = Math.abs(_djb2(pubkey));
  const h1 = hash % 360;
  const h2 = (h1 + 40) % 360;
  const accent = getAvatarColorVar(pubkey);
  return (
    `linear-gradient(135deg, hsl(${h1}, 30%, 28%), hsl(${h2}, 42%, 20%)),` +
    ` radial-gradient(circle at 30% 30%, ${accent}, transparent 65%)`
  );
}

/**
 * Render an identicon avatar as an HTML fragment — a div sized to fill its
 * parent (`.feed-avatar`, `.profile-avatar`) with the fractal SVG as its
 * background. The parent is responsible for clipping (border-radius +
 * overflow).
 *
 * @param {string} pubkey
 * @param {object} [opts] - forwarded to getFractalDataUrl
 * @returns {string} HTML string
 */
export function renderIdenticonAvatar(pubkey, opts) {
  const url = getFractalDataUrl(pubkey, opts);
  if (!url) return '&#x1F464;'; // 👤 fallback
  return `<div class="avatar-identicon" style="background-image: url('${url}');"></div>`;
}
