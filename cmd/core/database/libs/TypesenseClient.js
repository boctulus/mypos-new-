import Typesense from 'typesense';
import EnvLoader from '../../libs/EnvLoader.js';

// Cargar variables de entorno antes de usar cualquier variable
EnvLoader.load();

console.log('⚙️  Initializing Typesense client...');
console.log('TYPESENSE_HOST:', process.env.TYPESENSE_HOST);
console.log('TYPESENSE_PORT:', process.env.TYPESENSE_PORT);
console.log('TYPESENSE_PROTOCOL:', process.env.TYPESENSE_PROTOCOL);
console.log('TYPESENSE_API_KEY:', process.env.TYPESENSE_API_KEY ? '***' + process.env.TYPESENSE_API_KEY.slice(-3) : 'undefined');

if ( process.env.TYPESENSE_API_KEY === undefined ) {
  console.warn('⚠️  Warning: TYPESENSE_API_KEY is not set. Typesense client may not work properly.');
  process.exit(1);
}

const TypesenseClient = new Typesense.Client({
  nodes: [
    {
      host: process.env.TYPESENSE_HOST || 'localhost',
      port: Number(process.env.TYPESENSE_PORT) || 8108,
      protocol: process.env.TYPESENSE_PROTOCOL || 'http',
    },
  ],
  apiKey: process.env.TYPESENSE_API_KEY,
  connectionTimeoutSeconds: 5,
});

export const getTypesenseClient = () => TypesenseClient;

/**
 * Verifica si el servidor de Typesense está disponible
 * @returns {Promise<boolean>} true si está disponible, false si no
 */
export async function checkTypesenseConnection() {
  try {
    // Intentar obtener información de salud del servidor
    await TypesenseClient.health.retrieve();
    return true;
  } catch (error) {
    // Verificar si es un error de conexión
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.message.includes('ECONNREFUSED')) {
      return false;
    }
    // Para otros errores (auth, etc.), también consideramos que no está disponible
    return false;
  }
}

export default TypesenseClient;