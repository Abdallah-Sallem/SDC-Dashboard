/**
 * main.tsx
 * RÔLE : Point d'entrée principal de l'application React.
 * Initialise i18n, charge les polices, monte le composant racine.
 */

 import React from 'react'
 import ReactDOM from 'react-dom/client'
 import { App } from './App'
 import './ui/styles/global.css'
 import './ui/styles/adaptation-tokens.css'
 import './ui/styles/rtl-ltr.css'
 import './ui/i18n/i18n.config'
 
 ReactDOM.createRoot(document.getElementById('root')!).render(
   <React.StrictMode>
     <App />
   </React.StrictMode>
 )