import admin from 'firebase-admin';

// Singleton para cachear el estado del bucket
let bucketCheckCache = {
  checked: false,
  available: false,
  bucketName: null
};

export class FirebaseServiceAccount {
    constructor(serviceAccount, connect = true) {
        this._serviceAccount = serviceAccount;
        this._initialized = admin.apps.length > 0;
        this._storageBucket = serviceAccount?.storageBucket || null;
        this._bucketAvailable = bucketCheckCache.available; // Usar valor cacheado

        if (connect) {
          this._db = this.initializeFirebase();
        }
    }

    initializeFirebase() {
        if (this._initialized) {
            // Si ya está inicializado, usar cache o verificar solo una vez
            if (!bucketCheckCache.checked) {
                this.checkBucketAvailability().catch(err => {
                    console.error('Error verificando bucket:', err.message);
                });
            } else {
                // Usar valor cacheado
                this._bucketAvailable = bucketCheckCache.available;
            }
            return admin.firestore();
        }

        try {
            // Validar que las credenciales requeridas estén presentes
            if (!this._serviceAccount.privateKey) {
                throw new Error('FIREBASE_PRIVATE_KEY is not defined or empty');
            }
            if (!this._serviceAccount.projectId) {
                throw new Error('FIREBASE_PROJECT_ID is not defined or empty');
            }
            if (!this._serviceAccount.clientEmail) {
                throw new Error('FIREBASE_CLIENT_EMAIL is not defined or empty');
            }

            admin.initializeApp({
                credential: admin.credential.cert({
                    projectId: this._serviceAccount.projectId,
                    clientEmail: this._serviceAccount.clientEmail,
                    privateKey: this._serviceAccount.privateKey.replace(/\\n/g, '\n'),
                }),
                projectId: this._serviceAccount.projectId,
                storageBucket: this._storageBucket,
            });

            this._initialized = true;
            this._db = admin.firestore();

            this._db.settings({
                ignoreUndefinedProperties: true,
                preferRest: true
            });

            // Verificar disponibilidad del bucket solo si no se ha verificado antes
            if (!bucketCheckCache.checked) {
                this.checkBucketAvailability().catch(err => {
                    console.error('Error verificando bucket:', err.message);
                });
            }

            return this._db;
        } catch (error) {
            throw new Error(`Firebase initialization failed: ${error.message}`);
        }
    }

    /**
     * Verifica si Firebase Storage está disponible
     * Requiere plan Blaze (pago por uso) para funcionar
     * El resultado se cachea para evitar múltiples verificaciones
     */
    async checkBucketAvailability() {
        // Si ya se verificó, retornar valor cacheado
        if (bucketCheckCache.checked) {
            this._bucketAvailable = bucketCheckCache.available;
            return bucketCheckCache.available;
        }

        if (!this._storageBucket) {
            console.log('⚠️  Firebase Storage: Bucket no configurado en variables de entorno');
            bucketCheckCache.checked = true;
            bucketCheckCache.available = false;
            bucketCheckCache.bucketName = null;
            this._bucketAvailable = false;
            return false;
        }

        try {
            const bucket = admin.storage().bucket();
            // Intentar obtener metadata del bucket
            await bucket.getMetadata();

            console.log('✅ Firebase Storage: Bucket disponible y accesible');
            console.log(`   → Bucket: ${this._storageBucket}`);

            bucketCheckCache.checked = true;
            bucketCheckCache.available = true;
            bucketCheckCache.bucketName = this._storageBucket;
            this._bucketAvailable = true;

            return true;
        } catch (error) {
            if (error.code === 'storage/invalid-argument') {
                console.log('⚠️  Firebase Storage: Bucket no configurado correctamente');
                console.log('   → Tip: Verifica FIREBASE_STORAGE_BUCKET en .env');
            } else if (error.code === 403 || error.message.includes('403')) {
                console.log('⚠️  Firebase Storage: Plan Spark detectado (solo Blaze permite Storage)');
                console.log('   → Los archivos solo se guardarán localmente');
            } else if (error.code === 404 || error.message.includes('404')) {
                console.log('⚠️  Firebase Storage: Bucket no encontrado');
                console.log(`   → Bucket especificado: ${this._storageBucket}`);
            } else {
                console.log('⚠️  Firebase Storage: No disponible');
                console.log(`   → Error: ${error.message}`);
            }

            bucketCheckCache.checked = true;
            bucketCheckCache.available = false;
            bucketCheckCache.bucketName = this._storageBucket;
            this._bucketAvailable = false;

            return false;
        }
    }

    /**
     * Obtiene el estado del bucket (usa cache si está disponible)
     * @returns {boolean} true si el bucket está disponible
     */
    isBucketAvailable() {
        return bucketCheckCache.checked ? bucketCheckCache.available : this._bucketAvailable;
    }

    /**
     * Obtiene el nombre del bucket
     * @returns {string|null} Nombre del bucket o null si no está configurado
     */
    getBucketName() {
        return this._storageBucket || null;
    }

    /**
     * Fuerza una nueva verificación del bucket (útil para testing)
     * @returns {Promise<boolean>}
     */
    async recheckBucketAvailability() {
        bucketCheckCache.checked = false;
        return await this.checkBucketAvailability();
    }

    /**
     * Obtiene el estado del cache del bucket
     * @returns {object} Estado del cache
     */
    static getBucketCache() {
        return { ...bucketCheckCache };
    }
}
