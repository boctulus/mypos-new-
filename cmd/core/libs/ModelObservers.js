import Model from '../database/models/Model.js';

/**
 * Configuración de observadores globales para el sistema de modelos
 */

// Observer global para monitorear creación de usuarios
const userCreationObserver = {
  created: async (data, model) => {
    // Solo reaccionar cuando se creen usuarios
    if (data.entity === 'users') {
      console.log('👤 [Global Observer] ¡Usuario creado detectado!');
      console.log('📋 Detalles del usuario creado:', {
        entity: data.entity,
        userId: data.data.id || data.data.user_id,
        email: data.data.email,
        name: data.data.name,
        operation: data.operation,
        timestamp: data.timestamp.toISOString(),
        hasPassword: data.data.password ? 'Sí' : 'No'
      });
      console.log('🎉 Bienvenido al sistema:', data.data.email || 'Usuario sin email');
      console.log('---');
    }
  },

  // También podemos observar otros eventos si queremos
  updated: async (data, model) => {
    if (data.entity === 'users') {
      console.log('👤 [Global Observer] Usuario actualizado:', data.newData.email || data.newData.id);
    }
  },

  deleted: async (data, model) => {
    if (data.entity === 'users') {
      console.log('👤 [Global Observer] Usuario eliminado:', data.data.email || data.id);
    }
  }
};

// Observer global para auditoría general (opcional)
const auditObserver = {
  created: async (data, model) => {
    console.log(`📝 [Audit Observer] Documento creado en ${data.entity}: ${data.data.id}`);
  },
  
  updated: async (data, model) => {
    console.log(`📝 [Audit Observer] Documento actualizado en ${data.entity}: ${data.newData.id}`);
  },
  
  deleted: async (data, model) => {
    console.log(`📝 [Audit Observer] Documento eliminado en ${data.entity}: ${data.id}`);
  }
};

/**
 * Inicializa todos los observadores globales del sistema
 */
export function initializeGlobalObservers() {
  console.log('🔧 Inicializando observadores globales del sistema...');
  
  // Registrar observer para usuarios
  Model.addGlobalObserver(userCreationObserver);
  console.log('✅ Observer de creación de usuarios registrado');
  
  // Registrar observer de auditoría (comentar si no se desea)
  // Model.addGlobalObserver(auditObserver);  
  // console.log('✅ Observer de auditoría general registrado');
  
  console.log('🎯 Observadores globales inicializados correctamente\n');
}

/**
 * Limpia todos los observadores globales (útil para testing)
 */
export function clearGlobalObservers() {
  Model.removeGlobalObserver(userCreationObserver);
  Model.removeGlobalObserver(auditObserver);
  console.log('🧹 Observadores globales limpiados');
}

export default {
  initializeGlobalObservers,
  clearGlobalObservers,
  userCreationObserver,
  auditObserver
};