import { Repository, ObjectLiteral, FindManyOptions, FindOneOptions } from 'typeorm';

export interface ExtendedFindManyOptions<T> extends FindManyOptions<T> {
  hydrate?: boolean;
}

export interface ExtendedFindOneOptions<T> extends FindOneOptions<T> {
  hydrate?: boolean;
}

export class BaseRepository<T extends ObjectLiteral> extends Repository<T> {
  public removeHydratedProperties(entity: any, visited = new WeakSet()): void {
    if (!entity || typeof entity !== 'object' || visited.has(entity)) {
      return;
    }

    visited.add(entity);

    // Check for __hydratableConfigs on both the instance and its prototype
    const configs = entity.__hydratableConfigs || 
                   (entity.constructor && entity.constructor.prototype && entity.constructor.prototype.__hydratableConfigs) || 
                   [];
    for (const config of configs) {
      if (config.propertyName in entity) {
        delete entity[config.propertyName];
      }
    }

    for (const key in entity) {
      const value = entity[key];

      if (value && typeof value === 'object') {
        if (Array.isArray(value)) {
          for (const item of value) {
            this.removeHydratedProperties(item, visited);
          }
        } else if (value.constructor && value.constructor.name !== 'Date') {
          this.removeHydratedProperties(value, visited);
        }
      }
    }
  }

  async find(options?: ExtendedFindManyOptions<T>): Promise<T[]> {
    const shouldHydrate = options?.hydrate === true;

    const findOptions: FindManyOptions<T> = {};
    if (options) {
      for (const key in options) {
        if (key !== 'hydrate') {
          (findOptions as any)[key] = (options as any)[key];
        }
      }
    }

    const entities = await super.find(findOptions);

    if (shouldHydrate) {
      await this.hydrateEntities(entities);
    } else {
      for (const entity of entities) {
        this.removeHydratedProperties(entity);
      }
    }

    Object.defineProperty(entities, 'hydrate', {
      value: async () => {
        await this.hydrateEntities(entities);
        return entities;
      },
      enumerable: false,
    });

    return entities;
  }

  async findOne(options: ExtendedFindOneOptions<T>): Promise<T | null> {
    const shouldHydrate = options?.hydrate === true;

    const findOptions: FindOneOptions<T> = {};
    if (options) {
      for (const key in options) {
        if (key !== 'hydrate') {
          (findOptions as any)[key] = (options as any)[key];
        }
      }
    }

    const entity = await super.findOne(findOptions);

    if (entity) {
      if (shouldHydrate) {
        await this.hydrateEntity(entity);
      } else {
        this.removeHydratedProperties(entity);
      }

      Object.defineProperty(entity, 'hydrate', {
        value: async () => {
          await this.hydrateEntity(entity);
          return entity;
        },
        enumerable: false,
      });
    }

    return entity;
  }

  public async hydrateEntities(entities: T[], visited = new WeakSet()): Promise<void> {
    const promises: Promise<void>[] = [];
    
    for (const entity of entities) {
      // Avoid circular references
      if (!entity || typeof entity !== 'object' || visited.has(entity)) {
        continue;
      }
      
      visited.add(entity);
      
      // Hydrate the current entity's properties
      const configs = (entity as any).__hydratableConfigs || [];
      for (const config of configs) {
        if (typeof (entity as any)[config.methodName] === 'function') {
          promises.push(
            Promise.resolve((entity as any)[config.methodName]())
              .then((value) => {
                // Delete the property first if it exists to ensure we can redefine it
                if (config.propertyName in entity) {
                  delete (entity as any)[config.propertyName];
                }
                
                // Define property as writable so it can be reassigned later
                Object.defineProperty(entity, config.propertyName, {
                  value,
                  writable: true,
                  enumerable: true,
                  configurable: true,
                });
              })
              .catch((err) => console.error(`Hydration error for ${config.methodName}:`, err))
          );
        }
      }
      
      // Recursively hydrate nested relations
      for (const key in entity) {
        const value = entity[key];
        
        if (value && typeof value === 'object') {
          if (Array.isArray(value)) {
            // Hydrate array of entities
            promises.push(this.hydrateEntities(value, visited));
          } else if (value.constructor && value.constructor.name !== 'Date' && !visited.has(value)) {
            // Hydrate single nested entity
            promises.push(this.hydrateEntities([value], visited));
          }
        }
      }
    }
    
    await Promise.all(promises);
  }

  public async hydrateEntity(entity: T, visited = new WeakSet()): Promise<void> {
    await this.hydrateEntities([entity], visited);
  }
}
