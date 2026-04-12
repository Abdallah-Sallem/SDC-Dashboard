import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ar from './ar.json';
import fr from './fr.json';

i18n.use(initReactI18next).init({
  resources: { ar, fr },
  lng: 'fr',
  fallbackLng: 'fr',

})