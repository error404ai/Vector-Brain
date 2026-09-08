import { NextFunction, Request, Response } from 'express';
import { ZodError, ZodSchema } from 'zod';

export const zodValidationMiddleware = (schema: ZodSchema<any>) => {
  return async (req: Request, res: Response, next?: NextFunction) => {
    try {
      // Merge rather than pick one source. Preferring params meant any route
      // carrying an :id — PUT /ai-config/update/:id, PATCH /android-device/:id
      // and three others — validated the id and never looked at the body, so
      // those bodies went through unchecked. Body wins on a name clash because
      // that is where the payload lives; a schema that only wants the id still
      // finds it, and zod objects ignore keys they were not asked about.
      const params = req.params && Object.keys(req.params).length > 0 ? req.params : {};
      const validateData: any =
        req.method === 'GET'
          ? { ...params, ...(req.query || {}) }
          : { ...params, ...(req.body || {}) };

      await schema.parseAsync(validateData);
      if (typeof next === 'function') next();
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json(validationError(error, schema));
      }
      if (typeof next === 'function') next(error);
    }
  };
};

export function validationError(error: ZodError, schema?: ZodSchema<any>) {
  return {
    status: false,
    // Name the field that actually failed. The old generic sentence left users
    // guessing which input a 400 was complaining about.
    message: describeIssues(error),
    errors: error.errors,
    supported_parameters: schema ? getSupportedParameters(schema) : null,
    data: null,
  };
}

/** Turn zod issues into one readable sentence, e.g. "max_steps: ... exceed 200". */
function describeIssues(error: ZodError): string {
  const parts = (error.errors || [])
    .slice(0, 3)
    .map((issue) => {
      const field = Array.isArray(issue.path) ? issue.path.join('.') : '';
      return field ? `${field}: ${issue.message}` : issue.message;
    })
    .filter(Boolean);

  if (parts.length === 0) {
    return 'Oops! It looks like some information is missing or incorrect. Please check your input and try again.';
  }
  return parts.join(' · ');
}

function getSupportedParameters(schema: ZodSchema<any>) {
  try {
    const unwrap = (s: any): any => {
      const typeName = s?._def?.typeName;
      if (!typeName) return s;
      if (typeName === 'ZodOptional' || typeName === 'ZodNullable' || typeName === 'ZodDefault') {
        return unwrap(s._def.innerType || s._def.type || s._def.schema);
      }
      if (typeName === 'ZodEffects') {
        const inner = s._def?.innerType || s._def?.schema || s._def?.type || s._def?.arg || s._def?.effect?.innerType || s._def?.transform?.innerType;
        if (inner) return unwrap(inner);
        const maybe = s._def && Object.values(s._def).find((v: any) => v && v._def && v._def.typeName);
        if (maybe) return unwrap(maybe);
      }
      if (typeName === 'ZodUnion' && Array.isArray(s._def?.options)) {
        const opts = s._def.options.map((o: any) => unwrap(o));
        return { _isUnion: true, options: opts } as any;
      }
      return s;
    };

    const typeOf = (s: any) => {
      const t = s?._def?.typeName || (s && s._isUnion ? 'ZodUnion' : 'Unknown');
      if (t === 'ZodString') return 'string';
      if (t === 'ZodNumber') return 'number';
      if (t === 'ZodBoolean') return 'boolean';
      if (t === 'ZodBigInt') return 'bigint';
      if (t === 'ZodDate') return 'date';
      if (t === 'ZodArray') return 'array';
      if (t === 'ZodObject') return 'object';
      if (t === 'ZodEnum' || t === 'ZodNativeEnum') return 'enum';
      if (t === 'ZodUnion') return 'union';
      if (t === 'ZodLiteral') return 'literal';
      return t;
    };

    const buildFromObject = (objSchema: any) => {
      const def = objSchema._def;
      const shape = typeof def.shape === 'function' ? def.shape() : def.shape;
      const result: any = {};
      for (const key of Object.keys(shape)) {
        const child = shape[key];
        const un = unwrap(child);
        let type = typeOf(un);
        const required = !(child._def && (child._def.typeName === 'ZodOptional' || child._def.typeName === 'ZodNullable' || child._def.typeName === 'ZodDefault'));
        if (un && un._isUnion && Array.isArray(un.options)) {
          const optionTypes = Array.from(new Set(un.options.map((o: any) => typeOf(o))));
          if (optionTypes.includes('number')) {
            type = 'number';
          } else if (optionTypes.length === 1) {
            type = optionTypes[0];
          } else {
            type = 'union';
          }
        }
        if (type === 'object') {
          result[key] = { type, required, children: buildFromObject(un) };
        } else if (type === 'array') {
          const item = unwrap(un._def.type || un._def.element || un._def.type);
          result[key] = { type: 'array', required, items: { type: typeOf(item) } };
        } else if (type === 'enum') {
          result[key] = { type, required, values: extractEnumValues(un) };
        } else if (type === 'number' && un && un._isUnion) {
          result[key] = { type: 'number', required };
        } else {
          result[key] = { type, required };
        }
      }
      return result;
    };

    const unwrapped = unwrap(schema as any);
    const topType = unwrapped?._def?.typeName;
    if (topType === 'ZodObject') {
      return buildFromObject(unwrapped);
    }

    if (typeOf(unwrapped) === 'enum') {
      return { type: 'enum', values: extractEnumValues(unwrapped) };
    }

    return { type: typeOf(unwrapped) };
  } catch (e) {
    try {
      return (schema as any)?.description || null;
    } catch (ee) {
      return null;
    }
  }
}

function extractEnumValues(un: any) {
  try {
    const vals = un?._def?.values;
    if (Array.isArray(vals)) return vals;
    if (vals && typeof vals === 'object') return Object.values(vals);
    const options = un?._def?.options || un?._def?.items;
    if (Array.isArray(options)) {
      return options.map((o: any) => (o && o._def && o._def.value !== undefined ? o._def.value : o));
    }
    return null;
  } catch (e) {
    return null;
  }
}
