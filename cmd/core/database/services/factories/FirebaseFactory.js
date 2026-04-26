import { initializeServices } from '../../../../config/servicesSetup.js';
import { FirebaseServiceAccount } from '../../libs/FirebaseServiceAccount.js';

export default class FirebaseFactory {
  static async getDB() {
    const serviceAccount = await initializeServices();
    const firebase       = new FirebaseServiceAccount(serviceAccount);
    return firebase._db;
  }
}
