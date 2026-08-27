import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataSource, EntityTarget, ObjectLiteral, Repository } from 'typeorm';
import { addTransactionalDataSource, getDataSourceByName, initializeTransactionalContext, StorageDriver } from 'typeorm-transactional';
import envConfig from '../config/envConfig';
import { BaseRepository } from '@/repositories/BaseRepository';

initializeTransactionalContext({
  storageDriver: StorageDriver.ASYNC_LOCAL_STORAGE,
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const isTsMode = __filename.endsWith('.ts');
const fileExtension = isTsMode ? 'ts' : 'js';

const entitiesGlob = join(__dirname, '..', 'entities', '**', `*.${fileExtension}`);
const migrationsGlob = join(__dirname, '..', 'migrations', '**', `*.${fileExtension}`);
const subscribersGlob = join(__dirname, '..', 'subscribers', '**', `*.${fileExtension}`);

let dataSource = getDataSourceByName('default');

if (!dataSource) {
  dataSource = addTransactionalDataSource({
    patch: true,
    name: 'default',
    dataSource: new DataSource({
      type: 'mysql',
      host: envConfig.mysqlHost,
      port: envConfig.mysqlPort,
      username: envConfig.mysqlUsername,
      password: envConfig.mysqlPassword,
      database: envConfig.database,
      synchronize: envConfig.synchronize,
      migrationsRun: false,
      logging: false,
      timezone: 'Z',
      extra: {
        connectionLimit: 10,
        connectTimeout: 30000,
      },
      poolSize: 10,
      maxQueryExecutionTime: 30000,
      entities: [entitiesGlob],
      migrations: [migrationsGlob],
      subscribers: isTsMode ? [] : [subscribersGlob],
    }),
  });
}

const originalGetRepository = dataSource.getRepository;
dataSource.getRepository = function <T extends ObjectLiteral>(entity: EntityTarget<T>): Repository<T> {
  const repo = originalGetRepository.call(this, entity);
  
  // Bind find/findOne methods with hydration support
  repo.find = BaseRepository.prototype.find.bind(repo);
  repo.findOne = BaseRepository.prototype.findOne.bind(repo);
  (repo as any).hydrateEntity = BaseRepository.prototype.hydrateEntity.bind(repo);
  (repo as any).hydrateEntities = BaseRepository.prototype.hydrateEntities.bind(repo);
  (repo as any).removeHydratedProperties = BaseRepository.prototype.removeHydratedProperties.bind(repo);
  
  // Intercept createQueryBuilder to patch getMany/getOne/getManyAndCount methods
  const originalCreateQueryBuilder = repo.createQueryBuilder.bind(repo);
  repo.createQueryBuilder = function (...args: any[]) {
    const queryBuilder = originalCreateQueryBuilder(...args);
    
    // Store original methods
    const originalGetMany = queryBuilder.getMany.bind(queryBuilder);
    const originalGetOne = queryBuilder.getOne.bind(queryBuilder);
    const originalGetManyAndCount = queryBuilder.getManyAndCount.bind(queryBuilder);
    
    // Patch getMany to accept optional hydrate parameter
    queryBuilder.getMany = async function (options?: { hydrate?: boolean }) {
      const entities = await originalGetMany();
      const shouldHydrate = options?.hydrate === true;
      
      if (entities && entities.length > 0) {
        if (shouldHydrate) {
          await (repo as any).hydrateEntities(entities);
        } else {
          for (const entity of entities) {
            (repo as any).removeHydratedProperties(entity);
          }
        }
      }
      
      return entities;
    };
    
    // Patch getOne to accept optional hydrate parameter
    queryBuilder.getOne = async function (options?: { hydrate?: boolean }) {
      const entity = await originalGetOne();
      
      if (entity) {
        const shouldHydrate = options?.hydrate === true;
        
        if (shouldHydrate) {
          await (repo as any).hydrateEntity(entity);
        } else {
          (repo as any).removeHydratedProperties(entity);
        }
      }
      
      return entity;
    };
    
    // Patch getManyAndCount to accept optional hydrate parameter
    queryBuilder.getManyAndCount = async function (options?: { hydrate?: boolean }) {
      const [entities, count] = await originalGetManyAndCount();
      const shouldHydrate = options?.hydrate === true;
      
      if (entities && entities.length > 0) {
        if (shouldHydrate) {
          await (repo as any).hydrateEntities(entities);
        } else {
          for (const entity of entities) {
            (repo as any).removeHydratedProperties(entity);
          }
        }
      }
      
      return [entities, count];
    };
    
    return queryBuilder;
  };
  
  return repo;
};

export const AppDataSource = dataSource;
