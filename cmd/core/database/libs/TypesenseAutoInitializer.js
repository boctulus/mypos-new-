import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import TypesenseClient from './TypesenseClient.js';
import FirebaseFactory from '../services/factories/FirebaseFactory.js';
import TypesenseSchemaGenerator from './TypesenseSchemaGenerator.js';

/**
 * Automatically initializes Typesense collections for models that enable sync
 * Handles the complete flow: detection, schema creation, and synchronization
 */
export default class TypesenseAutoInitializer {
  constructor() {
    this.db = null;
    this.schemaGenerator = null;
    this.modelsPath = path.resolve(process.cwd(), 'models');
  }

  /**
   * Initialize Firebase and Typesense services
   */
  async initialize() {
    try {
      this.db = await FirebaseFactory.getDB();
      this.schemaGenerator = new TypesenseSchemaGenerator(this.db);
      console.log('🔧 TypesenseAutoInitializer services initialized');
    } catch (error) {
      console.error('❌ Failed to initialize TypesenseAutoInitializer:', error.message);
      throw error;
    }
  }

  /**
   * Scans the models directory and identifies models that sync with Typesense
   * @returns {Array} Array of model objects with metadata
   */
  async scanTypesenseModels() {
    const typesenseModels = [];
    
    try {
      const modelFiles = fs.readdirSync(this.modelsPath)
        .filter(file => file.endsWith('.js') && file !== 'Model.js');

      for (const file of modelFiles) {
        try {
          const modelPath = path.join(this.modelsPath, file);
          const modelUrl = pathToFileURL(modelPath).href;
          const ModelModule = await import(modelUrl);
          const ModelClass = ModelModule.default;

          if (ModelClass) {
            // Create a temporary instance to check properties
            const tempInstance = new ModelClass(this.db);
            
            if (tempInstance.syncToTypesense === true && tempInstance.entity) {
              typesenseModels.push({
                className: file.replace('.js', ''),
                entity: tempInstance.entity,
                useTenantSubcollections: tempInstance.useTenantSubcollections || false,
                filePath: modelPath,
                instance: tempInstance
              });
            }
          }
        } catch (error) {
          console.warn(`⚠️ Could not analyze model ${file}: ${error.message}`);
        }
      }
    } catch (error) {
      console.error('❌ Error scanning models directory:', error.message);
      throw error;
    }

    return typesenseModels;
  }

  /**
   * Checks if a Typesense collection exists using the correct prefixed name
   * @param {string} collectionName - Base name of the collection to check
   * @param {Object} modelInstance - Model instance to get the correct Typesense name
   * @returns {boolean} True if collection exists
   */
  async collectionExists(collectionName, modelInstance) {
    try {
      const typesenseCollectionName = modelInstance.getTypesenseCollectionName();
      console.log(`🏷️ Checking collection: ${collectionName} → ${typesenseCollectionName}`);
      await TypesenseClient.collections(typesenseCollectionName).retrieve();
      return true;
    } catch (error) {
      if (error.httpStatus === 404) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Creates a Typesense collection schema if it doesn't exist
   * @param {Object} modelInfo - Model information object
   * @param {string} tenantId - Optional tenant ID for tenant-aware models
   * @returns {boolean} True if collection was created or already exists
   */
  async ensureCollectionSchema(modelInfo, tenantId = null) {
    const { entity, useTenantSubcollections } = modelInfo;

    try {
      // For tenant-aware models without a tenant ID, skip (will be handled in processTenantAwareModel)
      if (useTenantSubcollections && !tenantId) {
        console.log(`🏢 Tenant-aware model detected: ${entity} (will be processed per tenant)`);
        return true;
      }

      const collectionExists = await this.collectionExists(entity, modelInfo.instance);

      if (!collectionExists) {
        console.log(`📋 Creating Typesense schema for collection: ${entity}${tenantId ? ` (tenant: ${tenantId})` : ''}`);
        await this.schemaGenerator.refreshTypesenseCollection(entity, tenantId);
        console.log(`✅ Schema created successfully for: ${entity}${tenantId ? ` (tenant: ${tenantId})` : ''}`);
        return true;
      } else {
        console.log(`✓ Collection already exists: ${entity}${tenantId ? ` (tenant: ${tenantId})` : ''}`);
        return true;
      }
    } catch (error) {
      console.error(`❌ Failed to ensure schema for ${entity}:`, error.message);
      return false;
    }
  }

  /**
   * Synchronizes Firebase data with Typesense for a collection
   * @param {Object} modelInfo - Model information object
   * @returns {boolean} True if synchronization was successful
   */
  async syncCollectionData(modelInfo) {
    const { entity, instance } = modelInfo;
    
    try {
      console.log(`🔄 Synchronizing data for collection: ${entity}`);
      
      // Get all documents from Firebase
      const documents = await instance.list(false); // Include deleted items for complete sync
      
      if (documents.length === 0) {
        console.log(`ℹ️ No documents to sync for collection: ${entity}`);
        return true;
      }

      // Transform and upsert documents to Typesense
      let successCount = 0;
      let errorCount = 0;

      // Get the correct Typesense collection name with prefix
      const typesenseCollectionName = instance.getTypesenseCollectionName();
      console.log(`🏷️ Syncing to: ${entity} → ${typesenseCollectionName}`);

      for (const doc of documents) {
        try {
          const transformed = await instance.transformDataForTypesense(doc);
          if (transformed !== false) {
            await TypesenseClient
              .collections(typesenseCollectionName)
              .documents()
              .upsert(transformed);
            successCount++;
          }
        } catch (error) {
          console.warn(`⚠️ Failed to sync document ${doc.id}: ${error.message}`);
          errorCount++;
        }
      }

      console.log(`✅ Sync completed for ${entity}: ${successCount} successful, ${errorCount} errors`);
      return errorCount === 0;
    } catch (error) {
      console.error(`❌ Failed to sync data for ${entity}:`, error.message);
      return false;
    }
  }

  /**
   * Verifies that a collection is working properly using the correct prefixed name
   * @param {string} collectionName - Base name of the collection to verify
   * @param {Object} modelInstance - Model instance to get the correct Typesense name
   * @returns {boolean} True if verification passes
   */
  async verifyCollection(collectionName, modelInstance) {
    try {
      const typesenseCollectionName = modelInstance.getTypesenseCollectionName();
      console.log(`🏷️ Verifying: ${collectionName} → ${typesenseCollectionName}`);

      // Try to perform a simple search to verify the collection is working
      const searchResult = await TypesenseClient
        .collections(typesenseCollectionName)
        .documents()
        .search({
          q: '*',
          per_page: 1
        });

      console.log(`✓ Verification passed for ${collectionName}: ${searchResult.found} documents indexed`);
      return true;
    } catch (error) {
      console.error(`❌ Verification failed for ${collectionName}:`, error.message);
      return false;
    }
  }

  /**
   * Gets all active tenants (stores) from the database
   * @returns {Array} Array of store objects with id
   */
  async getAllTenants() {
    try {
      const StoresModel = (await import('../../models/StoresModel.js')).default;
      const storesModel = new StoresModel(this.db);
      const stores = await storesModel.list();

      console.log(`🏢 Found ${stores.length} active stores (tenants)`);
      return stores;
    } catch (error) {
      console.warn('⚠️ Could not fetch stores:', error.message);
      return [];
    }
  }

  /**
   * Processes a tenant-aware model for all tenants
   * @param {Object} modelInfo - Model information object
   * @param {Array} tenants - Array of tenant objects
   * @returns {Object} Processing results
   */
  async processTenantAwareModel(modelInfo, tenants) {
    const { entity, instance, className } = modelInfo;
    const results = {
      processedTenants: 0,
      successfulTenants: 0,
      errors: []
    };

    console.log(`\n🏢 Processing tenant-aware model: ${entity} for ${tenants.length} tenants`);

    for (const tenant of tenants) {
      const tenantId = tenant.id;
      results.processedTenants++;

      try {
        console.log(`  📍 Processing tenant: ${tenantId}`);

        // Set the tenant for this model instance
        instance.setTenant(tenantId);

        // Step 1: Ensure schema exists for this tenant
        const collectionExists = await this.collectionExists(entity, instance);

        if (!collectionExists) {
          console.log(`    📋 Creating schema for ${entity} (tenant: ${tenantId})`);
          await this.schemaGenerator.refreshTypesenseCollection(entity, tenantId);
          console.log(`    ✅ Schema created for tenant ${tenantId}`);
        } else {
          console.log(`    ✓ Schema exists for tenant ${tenantId}`);
        }

        // Step 2: Sync data for this tenant
        console.log(`    🔄 Syncing data for tenant ${tenantId}`);
        const documents = await instance.list(false);

        if (documents.length === 0) {
          console.log(`    ℹ️ No documents to sync for tenant ${tenantId}`);
        } else {
          let successCount = 0;
          const typesenseCollectionName = instance.getTypesenseCollectionName();

          for (const doc of documents) {
            try {
              const transformed = await instance.transformDataForTypesense(doc);
              if (transformed !== false) {
                await TypesenseClient
                  .collections(typesenseCollectionName)
                  .documents()
                  .upsert(transformed);
                successCount++;
              }
            } catch (error) {
              console.warn(`    ⚠️ Failed to sync document ${doc.id}: ${error.message}`);
            }
          }
          console.log(`    ✅ Synced ${successCount} documents for tenant ${tenantId}`);
        }

        // Step 3: Verify collection for this tenant
        const verified = await this.verifyCollection(entity, instance);
        if (verified) {
          console.log(`    ✓ Verified collection for tenant ${tenantId}`);
        }

        results.successfulTenants++;

      } catch (error) {
        const errorMsg = `Failed to process tenant ${tenantId} for ${entity}: ${error.message}`;
        console.error(`    ❌ ${errorMsg}`);
        results.errors.push(errorMsg);
      }
    }

    console.log(`  📊 Tenant-aware processing complete: ${results.successfulTenants}/${results.processedTenants} successful`);
    return results;
  }

  /**
   * Main method to run the complete auto-initialization process
   * @returns {Object} Summary of the initialization process
   */
  async runAutoInitialization() {
    const summary = {
      totalModels: 0,
      processedModels: 0,
      createdSchemas: 0,
      syncedCollections: 0,
      verifiedCollections: 0,
      tenantAwareModels: 0,
      processedTenants: 0,
      errors: []
    };

    try {
      console.log('🚀 Starting Typesense auto-initialization...');

      // Initialize services
      await this.initialize();

      // Scan for Typesense-enabled models
      const typesenseModels = await this.scanTypesenseModels();
      summary.totalModels = typesenseModels.length;

      if (typesenseModels.length === 0) {
        console.log('ℹ️ No models found that sync with Typesense');
        return summary;
      }

      console.log(`📝 Found ${typesenseModels.length} models that sync with Typesense:`);
      typesenseModels.forEach(model => {
        console.log(`  - ${model.className} (${model.entity}${model.useTenantSubcollections ? ' - tenant-aware' : ''})`);
      });

      // Get all tenants (stores) for tenant-aware models
      const tenants = await this.getAllTenants();

      // Process each model
      for (const modelInfo of typesenseModels) {
        const { entity, useTenantSubcollections } = modelInfo;

        try {
          summary.processedModels++;

          // Handle tenant-aware models automatically
          if (useTenantSubcollections) {
            summary.tenantAwareModels++;

            if (tenants.length === 0) {
              console.log(`⚠️ No tenants found for tenant-aware model: ${entity}`);
              continue;
            }

            const tenantResults = await this.processTenantAwareModel(modelInfo, tenants);
            summary.processedTenants += tenantResults.processedTenants;
            summary.createdSchemas += tenantResults.successfulTenants;
            summary.syncedCollections += tenantResults.successfulTenants;
            summary.verifiedCollections += tenantResults.successfulTenants;
            summary.errors.push(...tenantResults.errors);

            continue;
          }

          // Handle non-tenant-aware models (existing logic)
          // Step 1: Ensure schema exists
          const schemaCreated = await this.ensureCollectionSchema(modelInfo);
          if (schemaCreated) {
            summary.createdSchemas++;
          }

          // Step 2: Sync data
          const dataSynced = await this.syncCollectionData(modelInfo);
          if (dataSynced) {
            summary.syncedCollections++;
          }

          // Step 3: Verify collection
          const verified = await this.verifyCollection(entity, modelInfo.instance);
          if (verified) {
            summary.verifiedCollections++;
          }

        } catch (error) {
          const errorMsg = `Failed to process model ${entity}: ${error.message}`;
          console.error(`❌ ${errorMsg}`);
          summary.errors.push(errorMsg);
        }
      }

      // Print summary
      console.log('\n📊 Auto-initialization Summary:');
      console.log(`   Total models found: ${summary.totalModels}`);
      console.log(`   Models processed: ${summary.processedModels}`);
      console.log(`   Tenant-aware models: ${summary.tenantAwareModels}`);
      if (summary.tenantAwareModels > 0) {
        console.log(`   Tenants processed: ${summary.processedTenants}`);
      }
      console.log(`   Schemas created/verified: ${summary.createdSchemas}`);
      console.log(`   Collections synchronized: ${summary.syncedCollections}`);
      console.log(`   Collections verified: ${summary.verifiedCollections}`);

      if (summary.errors.length > 0) {
        console.log(`   Errors: ${summary.errors.length}`);
        summary.errors.forEach(error => console.log(`     - ${error}`));
      } else {
        console.log('   ✅ No errors encountered');
      }

      console.log('\n🎉 Typesense auto-initialization completed!');

    } catch (error) {
      const errorMsg = `Auto-initialization failed: ${error.message}`;
      console.error(`❌ ${errorMsg}`);
      summary.errors.push(errorMsg);
    }

    return summary;
  }
}