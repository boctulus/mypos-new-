import EnvLoader from '../core/libs/EnvLoader.js';

let initializedServiceAccount = null;

const initializeServices = async () => {
  if (initializedServiceAccount) {
    return initializedServiceAccount;
  }

  // Cargar variables de entorno
  EnvLoader.load();

  const serviceAccount = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    privateKey: process.env.FIREBASE_PRIVATE_KEY,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
    measurementId: process.env.FIREBASE_MEASUREMENT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET
  };

  initializedServiceAccount = serviceAccount;
  return serviceAccount;
};

export { initializeServices };
