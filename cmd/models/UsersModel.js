import admin from 'firebase-admin';
import Model from '../core/database/models/Model.js';
import databasesConfig from '../config/databases.config.js';

export default class UsersModel extends Model {
  constructor(db, datasource = null) {
    super(db);
    this.entity = 'users';
    this.idField = 'id';
    this.useTenantSubcollections = false;
    this.uniqueFields = ['email', 'uid'];
    this.syncToTypesense = false;
    this.datasourceName = datasource || databasesConfig.defaultModelDatasource || 'firebase';
  }

  static async loadModel(collectionName = 'users', tenantId = null, datasource = null) {
    const configuredDatasource = databasesConfig.modelDatasources?.[collectionName]
      || databasesConfig.defaultModelDatasource
      || 'firebase';

    const finalDatasource = datasource !== null ? datasource : configuredDatasource;
    const db = null;
    const modelInstance = new UsersModel(db, finalDatasource);
    modelInstance.entity = collectionName;

    if (tenantId) {
      modelInstance.tenantId = tenantId;
    }

    console.log(`📦 UsersModel loaded with datasource: ${modelInstance.datasourceName}`);

    return modelInstance;
  }

  async getUserData(uid) {
    try {
      if (!this.db) {
        const FirebaseFactory = (await import('../../core/database/services/factories/FirebaseFactory.js')).default;
        this.db = await FirebaseFactory.getDB();
      }

      const userRef = this.db.doc(`users/${uid}`);
      const doc = await userRef.get();
      if (!doc.exists) {
        return null;
      }
      return doc.data();
    } catch (error) {
      throw new Error(`Error al obtener datos del usuario: ${error.message}`);
    }
  }

  async getByUid(uid) {
    return await this.getUserData(uid);
  }

  async updateByUid(uid, data) {
    try {
      if (!this.db) {
        const FirebaseFactory = (await import('../../core/database/services/factories/FirebaseFactory.js')).default;
        this.db = await FirebaseFactory.getDB();
      }

      const userRef = this.db.doc(`users/${uid}`);
      await userRef.set(data, { merge: true });
      return { success: true };
    } catch (error) {
      throw new Error(`Error al actualizar usuario: ${error.message}`);
    }
  }

  async deleteByUid(uid) {
    try {
      if (!this.db) {
        const FirebaseFactory = (await import('../../core/database/services/factories/FirebaseFactory.js')).default;
        this.db = await FirebaseFactory.getDB();
      }

      const userRef = this.db.doc(`users/${uid}`);
      await userRef.delete();
      return { success: true };
    } catch (error) {
      throw new Error(`Error al eliminar usuario: ${error.message}`);
    }
  }

  async listUsers() {
    try {
      const listUsersResult = await admin.auth().listUsers();
      return listUsersResult.users;
    } catch (error) {
      throw new Error(`Error listing users from Firebase Auth: ${error.message}`);
    }
  }

  async getCountByMonth(year, month, debug = false) {
    try {
      const users = await this.listUsers();

      if (debug) {
        console.log(`\n🔍 [DEBUG] Getting user count for ${year}-${month}`);
        console.log(`📊 [DEBUG] Total users found: ${users.length}`);
      }

      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0, 23, 59, 59);

      const perMonth = users.filter((user) => {
        const creationTimeStr = user.metadata?.creationTime;
        if (!creationTimeStr) return false;

        const createdDate = new Date(creationTimeStr);
        return createdDate >= startDate && createdDate <= endDate;
      });

      if (debug) {
        console.log(`\n✅ [DEBUG] Users in ${year}-${month}: ${perMonth.length}`);
      }

      return perMonth.length;
    } catch (error) {
      throw new Error(`Error filtering users by month: ${error.message}`);
    }
  }
}