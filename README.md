# SVG Optimizer

Outil d'optimisation SVG basé sur [SVGO](https://github.com/svg/svgo), avec interface graphique et persistance des paramètres.

## Lancer

```bash
npm install
npm run dev
```

Ouvrir [http://localhost:5173](http://localhost:5173).

## Build

```bash
npm run build
```

Le résultat est dans `dist/` — servable statiquement sans serveur backend.

## Fonctionnalités

- **3 modes d'entrée** : glisser-déposer, sélection de fichier, coller du SVG
- **46 plugins SVGO** configurables individuellement, groupés par catégorie
- **Options générales** : passes multiples, prettify, précision des nombres et des transformations
- **Aperçu côte à côte** original / optimisé, avec onglet code SVG
- **Stats** : taille originale → optimisée → économie %
- **Onglet Analyse** : répartition du poids par tag / attribut, plus gros sous-arbres et recommandations
- **Détection des rasters embarqués** : images `data:image/*` isolées avec taille, dimensions et surcoût d'encodage
- **Copier / Télécharger** le SVG optimisé
- **Persistance automatique** des paramètres via `localStorage`
- **Préréglages** nommés avec export/import JSON (portable entre navigateurs)
- **Optimisation non-bloquante** via Web Worker

## Stack

- [Vite](https://vitejs.dev/) + TypeScript
- [SVGO](https://github.com/svg/svgo) v3
