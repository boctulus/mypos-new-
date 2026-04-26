import admin from 'firebase-admin';

export class AuthController {
  constructor(serviceAccount) {
    this._serviceAccount = serviceAccount;
    this._db = null;
    this._initialized = false;
  }

  initializeFirebase() {
    if (this._db) {
      return this._db;
    }

    if (admin.apps.length > 0) {
      this._db = admin.firestore();
      this._initialized = true;
      return this._db;
    }

    if (!this._serviceAccount?.privateKey || !this._serviceAccount?.projectId || !this._serviceAccount?.clientEmail) {
      throw new Error('Firebase credentials not properly configured');
    }

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: this._serviceAccount.projectId,
        clientEmail: this._serviceAccount.clientEmail,
        privateKey: this._serviceAccount.privateKey.replace(/\\n/g, '\n'),
      }),
      projectId: this._serviceAccount.projectId,
    });

    this._db = admin.firestore();
    this._db.settings({
      ignoreUndefinedProperties: true,
      preferRest: true,
    });

    this._initialized = true;
    return this._db;
  }

  async getUserByEmail(email) {
    const userRecord = await admin.auth().getUserByEmail(email);
    return userRecord;
  }

  async getUserByUid(uid) {
    const userRecord = await admin.auth().getUserByUid(uid);
    return userRecord;
  }

  async listUsers(maxResults = 1000, pageToken = null) {
    const result = await admin.auth().listUsers(maxResults, pageToken);
    return result;
  }

  async createUser(email, password, displayName = null) {
    const userRecord = await admin.auth().createUser({
      email,
      password,
      displayName,
    });
    return userRecord;
  }

  async updateUser(uid, updates) {
    const userRecord = await admin.auth().updateUser(uid, updates);
    return userRecord;
  }

  async deleteUser(uid) {
    await admin.auth().deleteUser(uid);
  }

  async setCustomUserClaims(uid, claims) {
    await admin.auth().setCustomUserClaims(uid, claims);
  }

  async verifyEmail(uid) {
    const customClaims = { role: 'consumer', emailVerified: true };
    await admin.auth().setCustomUserClaims(uid, customClaims);
    const userRecord = await admin.auth().getUser(uid);
    return userRecord;
  }

  async enableUser(uid) {
    const userRecord = await admin.auth().updateUser(uid, { disabled: false });
    return userRecord;
  }

  async disableUser(uid) {
    const userRecord = await admin.auth().updateUser(uid, { disabled: true });
    return userRecord;
  }

  async setUserRole(uid, role) {
    const customClaims = { role };
    await admin.auth().setCustomUserClaims(uid, customClaims);
    const userRecord = await admin.auth().getUser(uid);
    return userRecord;
  }

  async setUserPassword(uid, password) {
    const userRecord = await admin.auth().updateUser(uid, { password });
    return userRecord;
  }

  async updateUserEmail(uid, newEmail) {
    const userRecord = await admin.auth().updateUser(uid, { email: newEmail });
    return userRecord;
  }

  async getUserByEmailLink(emailLink) {
    const userRecord = await admin.auth().getUserByEmail(emailLink);
    return userRecord;
  }

  generateEmailVerificationLink(email) {
    return admin.auth().generateEmailVerificationLink(email);
  }

  generatePasswordResetLink(email) {
    return admin.auth().generatePasswordResetLink(email);
  }

  generateSignInWithEmailLink(email, continueUrl) {
    return admin.auth().generateSignInWithEmailLink(email, continueUrl);
  }
}