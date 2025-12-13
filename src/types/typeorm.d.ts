import 'typeorm';

declare module 'typeorm' {
  interface FindManyOptions<Entity = any> {
    hydrate?: boolean;
  }

  interface FindOneOptions<Entity = any> {
    hydrate?: boolean;
  }

  interface SelectQueryBuilder<Entity> {
    getMany(options?: { hydrate?: boolean }): Promise<Entity[]>;
    getOne(options?: { hydrate?: boolean }): Promise<Entity | null>;
    getManyAndCount(options?: { hydrate?: boolean }): Promise<[Entity[], number]>;
    getManyWithHydration(options?: { hydrate?: boolean }): Promise<Entity[]>;
    getOneWithHydration(options?: { hydrate?: boolean }): Promise<Entity | null>;
  }
}
