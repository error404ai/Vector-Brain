import { Repository, FindManyOptions, FindOneOptions, SelectQueryBuilder } from 'typeorm';

declare module 'typeorm' {
  interface FindManyOptions<Entity = any> {
    hydrate?: boolean;
  }

  interface FindOneOptions<Entity = any> {
    hydrate?: boolean;
  }

  interface SelectQueryBuilder<Entity> {
    /**
     * Execute query and get many entities with optional hydration control
     * @param options - Optional hydration settings. If hydrate is true, @Hydrate decorated methods will be called.
     *                  If false or undefined (default), hydrated properties will be removed.
     */
    getMany(options?: { hydrate?: boolean }): Promise<Entity[]>;

    /**
     * Execute query and get one entity with optional hydration control
     * @param options - Optional hydration settings. If hydrate is true, @Hydrate decorated methods will be called.
     *                  If false or undefined (default), hydrated properties will be removed.
     */
    getOne(options?: { hydrate?: boolean }): Promise<Entity | null>;

    /**
     * Execute query and get many entities with count and optional hydration control
     * @param options - Optional hydration settings. If hydrate is true, @Hydrate decorated methods will be called.
     *                  If false or undefined (default), hydrated properties will be removed.
     */
    getManyAndCount(options?: { hydrate?: boolean }): Promise<[Entity[], number]>;

    /**
     * Execute query and get many entities with hydration control
     * @param options - Optional hydration settings. If hydrate is true, @Hydrate decorated methods will be called.
     *                  If false or undefined (default), hydrated properties will be removed.
     * @deprecated Use getMany with hydrate option instead
     */
    getManyWithHydration(options?: { hydrate?: boolean }): Promise<Entity[]>;

    /**
     * Execute query and get one entity with hydration control
     * @param options - Optional hydration settings. If hydrate is true, @Hydrate decorated methods will be called.
     *                  If false or undefined (default), hydrated properties will be removed.
     * @deprecated Use getOne with hydrate option instead
     */
    getOneWithHydration(options?: { hydrate?: boolean }): Promise<Entity | null>;
  }
}
