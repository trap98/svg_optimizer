export interface PluginDef {
  name: string;
  label: string;
  description: string;
  defaultEnabled: boolean;
  group: string;
  /** Plugin breaks standalone SVG files (opened directly in a browser or image viewer). */
  breaksSvgStandalone?: boolean;
}

export const PLUGIN_DEFS: PluginDef[] = [
  // ── Nettoyage document ──────────────────────────────────────────────────
  {
    name: "removeDoctype",
    label: "Supprimer DOCTYPE",
    description: "Supprime la déclaration DOCTYPE du document",
    defaultEnabled: true,
    group: "Document",
  },
  {
    name: "removeXMLProcInst",
    label: "Supprimer <?xml ?>",
    description: "Supprime l'instruction de traitement XML en en-tête",
    defaultEnabled: true,
    group: "Document",
  },
  {
    name: "removeComments",
    label: "Supprimer les commentaires",
    description: "Supprime tous les commentaires HTML/XML du fichier",
    defaultEnabled: true,
    group: "Document",
  },
  {
    name: "removeMetadata",
    label: "Supprimer <metadata>",
    description: "Supprime le bloc <metadata> (données RDF, Dublin Core, etc.)",
    defaultEnabled: true,
    group: "Document",
  },
  {
    name: "removeTitle",
    label: "Supprimer <title>",
    description: "Supprime l'élément <title>. Attention : nuit à l'accessibilité",
    defaultEnabled: false,
    group: "Document",
  },
  {
    name: "removeDesc",
    label: "Supprimer <desc>",
    description: "Supprime l'élément <desc>. Attention : nuit à l'accessibilité",
    defaultEnabled: false,
    group: "Document",
  },
  {
    name: "removeEditorsNSData",
    label: "Supprimer données éditeurs",
    description: "Supprime les namespaces et attributs propres à Inkscape, Sketch, Illustrator, etc.",
    defaultEnabled: true,
    group: "Document",
  },
  {
    name: "removeXMLNS",
    label: "Supprimer xmlns (SVG inline)",
    description: "Supprime xmlns=\"http://www.w3.org/2000/svg\" sur <svg>. Utile pour SVG intégré en HTML, mais le fichier ne s'ouvre plus correctement en standalone (Firefox, visionneuses).",
    defaultEnabled: false,
    group: "Document",
    breaksSvgStandalone: true,
  },
  {
    name: "removeXlink",
    label: "Remplacer xlink: par href",
    description: "Remplace les attributs xlink:href obsolètes par href (SVG 2)",
    defaultEnabled: false,
    group: "Document",
  },
  {
    name: "removeUnusedNS",
    label: "Supprimer namespaces inutilisés",
    description: "Supprime les déclarations de namespace qui ne sont référencées nulle part",
    defaultEnabled: true,
    group: "Document",
  },

  // ── Attributs & styles ──────────────────────────────────────────────────
  {
    name: "cleanupAttrs",
    label: "Nettoyer les attributs",
    description: "Supprime les espaces superflus et les retours à la ligne dans les valeurs d'attributs",
    defaultEnabled: true,
    group: "Attributs & styles",
  },
  {
    name: "cleanupListOfValues",
    label: "Nettoyer les listes de valeurs",
    description: "Arrondit les nombres dans les attributs de type liste (ex. viewBox, points, gradients)",
    defaultEnabled: false,
    group: "Attributs & styles",
  },
  {
    name: "mergeStyles",
    label: "Fusionner les <style>",
    description: "Fusionne plusieurs éléments <style> en un seul",
    defaultEnabled: true,
    group: "Attributs & styles",
  },
  {
    name: "inlineStyles",
    label: "Intégrer les styles CSS (inline)",
    description: "Déplace les règles CSS des blocs <style> dans des attributs style des éléments",
    defaultEnabled: true,
    group: "Attributs & styles",
  },
  {
    name: "minifyStyles",
    label: "Minifier le CSS",
    description: "Minifie le contenu des éléments <style> via CSSO",
    defaultEnabled: true,
    group: "Attributs & styles",
  },
  {
    name: "convertStyleToAttrs",
    label: "Convertir style= en attributs",
    description: "Convertit les propriétés CSS du style inline en attributs de présentation SVG",
    defaultEnabled: false,
    group: "Attributs & styles",
  },
  {
    name: "removeStyleElement",
    label: "Supprimer tous les <style>",
    description: "Supprime tous les éléments <style> du document",
    defaultEnabled: false,
    group: "Attributs & styles",
  },
  {
    name: "removeScriptElement",
    label: "Supprimer tous les <script>",
    description: "Supprime tous les éléments <script> du document",
    defaultEnabled: false,
    group: "Attributs & styles",
  },
  {
    name: "removeUnknownsAndDefaults",
    label: "Supprimer valeurs par défaut",
    description: "Supprime les attributs inconnus et ceux ayant leur valeur par défaut (inutiles)",
    defaultEnabled: true,
    group: "Attributs & styles",
  },
  {
    name: "removeEmptyAttrs",
    label: "Supprimer attributs vides",
    description: "Supprime les attributs dont la valeur est une chaîne vide",
    defaultEnabled: true,
    group: "Attributs & styles",
  },
  {
    name: "sortAttrs",
    label: "Trier les attributs",
    description: "Trie les attributs SVG dans un ordre déterministe pour améliorer la compression gzip",
    defaultEnabled: false,
    group: "Attributs & styles",
  },

  // ── Couleurs & valeurs ──────────────────────────────────────────────────
  {
    name: "convertColors",
    label: "Convertir les couleurs",
    description: "Convertit les couleurs vers leur représentation la plus courte (hex, rgb, mot-clé)",
    defaultEnabled: true,
    group: "Couleurs & valeurs",
  },
  {
    name: "cleanupNumericValues",
    label: "Arrondir les valeurs numériques",
    description: "Arrondit les nombres flottants et supprime les unités px redondantes",
    defaultEnabled: true,
    group: "Couleurs & valeurs",
  },
  {
    name: "convertOneStopGradients",
    label: "Simplifier les dégradés 1 cran",
    description: "Convertit les dégradés n'ayant qu'un seul stop en couleur unie",
    defaultEnabled: true,
    group: "Couleurs & valeurs",
  },

  // ── Structure & éléments ────────────────────────────────────────────────
  {
    name: "cleanupIds",
    label: "Nettoyer les IDs",
    description: "Raccourcit les IDs utilisés et supprime les IDs déclarés mais non référencés",
    defaultEnabled: true,
    group: "Structure",
  },
  {
    name: "removeUselessDefs",
    label: "Supprimer <defs> inutiles",
    description: "Supprime les éléments <defs> dont aucun contenu n'est référencé dans le SVG",
    defaultEnabled: true,
    group: "Structure",
  },
  {
    name: "removeNonInheritableGroupAttrs",
    label: "Supprimer attrs non-héritables dans <g>",
    description: "Supprime les attributs de présentation non-héritables placés sur un <g>",
    defaultEnabled: true,
    group: "Structure",
  },
  {
    name: "removeUselessStrokeAndFill",
    label: "Supprimer stroke/fill sans effet",
    description: "Supprime les attributs stroke et fill qui n'ont aucun effet visuel",
    defaultEnabled: true,
    group: "Structure",
  },
  {
    name: "cleanupEnableBackground",
    label: "Nettoyer enable-background",
    description: "Supprime ou nettoie l'attribut enable-background déprécié",
    defaultEnabled: true,
    group: "Structure",
  },
  {
    name: "removeHiddenElems",
    label: "Supprimer éléments cachés",
    description: "Supprime les éléments invisibles : display:none, opacity:0, taille nulle, etc.",
    defaultEnabled: true,
    group: "Structure",
  },
  {
    name: "removeEmptyText",
    label: "Supprimer textes vides",
    description: "Supprime les éléments <text> et <tspan> ne contenant aucun texte",
    defaultEnabled: true,
    group: "Structure",
  },
  {
    name: "removeEmptyContainers",
    label: "Supprimer conteneurs vides",
    description: "Supprime les éléments conteneurs (<g>, <svg>, <marker>, etc.) sans enfants",
    defaultEnabled: true,
    group: "Structure",
  },
  {
    name: "removeOffCanvasPaths",
    label: "Supprimer paths hors-canvas",
    description: "Supprime les éléments <path> entièrement en dehors du viewBox visible",
    defaultEnabled: false,
    group: "Structure",
  },
  {
    name: "removeRasterImages",
    label: "Supprimer images raster",
    description: "Supprime les éléments <image> référençant des images bitmap (PNG, JPEG…)",
    defaultEnabled: false,
    group: "Structure",
  },
  {
    name: "sortDefsChildren",
    label: "Trier les enfants de <defs>",
    description: "Trie les éléments dans <defs> par type pour améliorer la compression gzip",
    defaultEnabled: true,
    group: "Structure",
  },

  // ── Groupes & transforms ────────────────────────────────────────────────
  {
    name: "moveElemsAttrsToGroup",
    label: "Remonter attrs communs vers <g>",
    description: "Déplace les attributs identiques de tous les enfants vers leur parent <g>",
    defaultEnabled: true,
    group: "Groupes & transformations",
  },
  {
    name: "moveGroupAttrsToElems",
    label: "Descendre attrs de <g> vers enfants",
    description: "Quand <g> n'a qu'un seul enfant, déplace ses attributs vers cet enfant",
    defaultEnabled: true,
    group: "Groupes & transformations",
  },
  {
    name: "collapseGroups",
    label: "Supprimer groupes superflus",
    description: "Supprime les éléments <g> redondants qui n'apportent aucune sémantique",
    defaultEnabled: true,
    group: "Groupes & transformations",
  },
  {
    name: "convertTransform",
    label: "Optimiser les transformations",
    description: "Fusionne, simplifie et normalise les attributs transform",
    defaultEnabled: true,
    group: "Groupes & transformations",
  },
  {
    name: "applyTransforms",
    label: "Appliquer les transformations",
    description: "Applique les matrices transform directement aux coordonnées des éléments",
    defaultEnabled: false,
    group: "Groupes & transformations",
  },

  // ── Formes & paths ──────────────────────────────────────────────────────
  {
    name: "convertShapeToPath",
    label: "Convertir formes en <path>",
    description: "Convertit <rect>, <circle>, <ellipse>, <line>, <polyline>, <polygon> en <path>",
    defaultEnabled: true,
    group: "Formes & paths",
  },
  {
    name: "convertEllipseToCircle",
    label: "Convertir ellipse → cercle",
    description: "Remplace les <ellipse rx=ry> par <circle> plus court",
    defaultEnabled: true,
    group: "Formes & paths",
  },
  {
    name: "convertPathData",
    label: "Optimiser les données path",
    description: "Arrondit, simplifie et compacte les commandes SVG path (M, L, C, etc.)",
    defaultEnabled: true,
    group: "Formes & paths",
  },
  {
    name: "mergePaths",
    label: "Fusionner les paths adjacents",
    description: "Fusionne plusieurs <path> consécutifs partageant les mêmes attributs",
    defaultEnabled: true,
    group: "Formes & paths",
  },
  {
    name: "reusePaths",
    label: "Réutiliser les paths identiques",
    description: "Déduplique les <path> identiques via <defs> + <use> pour réduire la taille",
    defaultEnabled: false,
    group: "Formes & paths",
  },
  {
    name: "removeViewBox",
    label: "Supprimer viewBox",
    description: "Supprime viewBox quand width/height sont présents. Casse le redimensionnement CSS du SVG.",
    defaultEnabled: false,
    group: "Formes & paths",
    breaksSvgStandalone: true,
  },
  {
    name: "removeDimensions",
    label: "Supprimer width/height",
    description: "Supprime les attributs width/height en gardant le viewBox, pour un SVG fluide en CSS",
    defaultEnabled: false,
    group: "Formes & paths",
  },
];
