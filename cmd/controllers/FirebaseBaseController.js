import { FirebaseServiceAccount } from '../core/database/libs/FirebaseServiceAccount.js';

export class FirebaseBaseController {
    constructor(serviceAccount, connect = true) {
        this._serviceAccount = serviceAccount;
        this._firebaseService = new FirebaseServiceAccount(serviceAccount, connect);
        
        if (connect) {
            // Asegurarse de que el servicio ya inicializó Firebase si connect es true
            this._db = this._firebaseService._db;
        }
    }

    // Método opcional para compatibilidad con código existente
    initializeFirebase() {
        return this._firebaseService.initializeFirebase();
    }

    // Propiedad para acceder a la base de datos
    get db() {
        return this._firebaseService._db;
    }
}