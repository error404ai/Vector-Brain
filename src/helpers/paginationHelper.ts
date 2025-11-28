import { FindManyOptions, Repository, SelectQueryBuilder } from 'typeorm';

export interface PaginationOptions {
  page?: number;
  limit?: number;
  hydrate?: boolean;
}

export interface PaginationResult<T> {
  message: string;
  data: T[];
  pagination: {
    currentPage: number;
    totalPages: number;
    totalCount: number;
    pageSize: number;
    hasPreviousPage: boolean;
    hasNextPage: boolean;
  };
}

/**
 * Universal Pagination Function
 * 
 * Handles pagination for both TypeORM Repository and SelectQueryBuilder patterns.
 * Automatically detects the source type and applies appropriate pagination logic.
 * 
 * @template T - The entity type being paginated
 * @param source - Either a TypeORM Repository<T> or SelectQueryBuilder<T>
 * @param options - Pagination configuration object
 * @param options.page - Page number (default: 1, minimum: 1)
 * @param options.limit - Items per page (default: 10, minimum: 1)
 * @param options.findOptions - Additional TypeORM FindManyOptions (only used with Repository)
 * 
 * @returns Promise<PaginationResult<T>> - Standardized pagination response
 * 
 * USAGE EXAMPLES:
 * 
 * 1. Basic Repository Pagination:
 * ```typescript
 * const result = await paginate(userRepository, { page: 1, limit: 10 });
 * ```
 * 
 * 2. Repository with Relations:
 * ```typescript
 * const result = await paginate(userRepository, {
 *   page: 1,
 *   limit: 10,
 *   findOptions: {
 *     relations: ['profile', 'roles'],
 *     select: ['id', 'name', 'email']
 *   }
 * });
 * ```
 * 
 * 3. Repository with Conditions:
 * ```typescript
 * const result = await paginate(userRepository, {
 *   page: 1,
 *   limit: 10,
 *   findOptions: {
 *     where: { status: 'active', age: MoreThan(18) },
 *     order: { createdAt: 'DESC' }
 *   }
 * });
 * ```
 * 
 * 4. QueryBuilder (Complex Queries):
 * ```typescript
 * const queryBuilder = userRepository
 *   .createQueryBuilder('user')
 *   .leftJoinAndSelect('user.profile', 'profile')
 *   .where('user.status = :status', { status: 'active' })
 *   .orderBy('user.createdAt', 'DESC');
 * 
 * const result = await paginate(queryBuilder, { page: 1, limit: 10 });
 * ```
 * 
 * 5. QueryBuilder with Joins and Conditions:
 * ```typescript
 * const queryBuilder = eventRepository
 *   .createQueryBuilder('event')
 *   .leftJoinAndSelect('event.guests', 'guests')
 *   .leftJoinAndSelect('event.location', 'location')
 *   .where('event.status = :status', { status: 'active' })
 *   .andWhere('event.startDate > :date', { date: new Date() })
 *   .orderBy('event.startDate', 'ASC');
 * 
 * const result = await paginate(queryBuilder, { page: 2, limit: 25 });
 * ```
 */
const paginate = async <T>(
  source: SelectQueryBuilder<T> | Repository<T>,
  {
    page = 1,
    limit = 10,
    findOptions,
  }: PaginationOptions & { findOptions?: FindManyOptions<T> }
): Promise<PaginationResult<T>> => {
  // Validate and sanitize input parameters
  const pageNumber = Math.max(1, parseInt(page.toString(), 10));
  const pageLimit = Math.max(1, parseInt(limit.toString(), 10));

  // Calculate skip value for pagination offset
  const skip = (pageNumber - 1) * pageLimit;

  let items: T[], totalCount: number;
  let entityName: string | undefined;

  // Handle Repository pattern - uses findAndCount with FindManyOptions
  if ('findAndCount' in source) {
    const opts: FindManyOptions<T> = {
      skip,
      take: pageLimit,
      ...(findOptions || {}), // Merge user-provided findOptions
    };
    [items, totalCount] = await source.findAndCount(opts);
    entityName = source.metadata?.name; // Extract entity name from Repository metadata
  } else {
    // Handle SelectQueryBuilder pattern - uses getManyAndCount with skip/take
    [items, totalCount] = await source
      .skip(skip)
      .take(pageLimit)
      .getManyAndCount({hydrate: true});

    entityName = source.expressionMap?.mainAlias?.metadata?.name; // Extract entity name from QueryBuilder
  }

  // Calculate total pages (always round up)
  const totalPages = Math.ceil(totalCount / pageLimit);

  return {
    message: entityName
      ? `${entityName} items fetched successfully`
      : 'Items fetched successfully',
    data: items,
    pagination: {
      currentPage: pageNumber,
      totalPages,
      totalCount,
      pageSize: pageLimit,
      hasPreviousPage: pageNumber > 1,
      hasNextPage: pageNumber < totalPages,
    },
  };
};

export default paginate;
