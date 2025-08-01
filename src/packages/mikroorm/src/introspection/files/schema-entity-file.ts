import type {
	Dictionary,
	EntityMetadata,
	EntityProperty,
	NamingStrategy,
	Platform,
} from '@mikro-orm/core';
import { ReferenceKind, Utils } from '@mikro-orm/core';
import pluralize from 'pluralize';
import { identifierForEnumValue, pascalToCamelCaseString, pascalToKebabCaseString } from '../utils';
import { BaseFile } from './base-file';
import { DatabaseType } from '../../database';
import { isEntityWithSinglePrimaryKey } from '../generate';

const friendlyNameForDatabaseType = (type: DatabaseType) => {
	if (type === 'mssql') return 'SQL Server';
	if (type === 'mysql') return 'MySQL';
	if (type === 'postgresql') return 'PostgreSQL';
	if (type === 'sqlite') return 'SQLite';

	throw new Error('Unimplemented database type: ' + type);
};

export class SchemaEntityFile extends BaseFile {
	protected readonly coreImports = new Set<string>();
	protected readonly scalarImports = new Set<string>();
	protected readonly entityImports = new Set<string>();
	protected readonly enumImports = new Set<string>();
	public readonly errors: string[] = [];

	constructor(
		protected readonly meta: EntityMetadata,
		protected readonly namingStrategy: NamingStrategy,
		protected readonly platform: Platform,
		protected readonly databaseType: DatabaseType,
		protected readonly entityLookup: Map<string, EntityMetadata<any>>
	) {
		super(meta, namingStrategy, platform);
	}

	getBasePath() {
		return `backend/schema/`;
	}

	getBaseName() {
		const fileName = pascalToKebabCaseString(this.meta.className);
		return `${fileName}.ts`;
	}

	generate(): string {
		const enumDefinitions: string[] = [];
		let classBody = '';
		const generatedPropertyNames = new Set<string>();
		const props = Object.values(this.meta.properties);
		props.forEach((prop) => {
			const relatedEntity = this.entityLookup.get(prop.type);
			if (relatedEntity) {
				// These are not supported yet, just skip them.
				if (!isEntityWithSinglePrimaryKey(relatedEntity)) {
					this.errors.push(
						` - Warning: Composite primary keys are not supported. ${this.meta.className} entity references ${prop.type} entity with composite primary key.`
					);
					return;
				}
			}

			if (generatedPropertyNames.has(prop.name)) {
				this.errors.push(
					` - Warning: Property ${prop.name} on ${this.meta.className} entity is not unique. Additional instances of this property were ignored.`
				);
				return;
			}

			generatedPropertyNames.add(prop.name);

			const decorator = this.getPropertyDecorator(prop);
			const definition = this.getPropertyDefinition(prop);

			if (classBody && !classBody.endsWith('\n\n')) {
				classBody += '\n';
			}

			classBody += decorator;
			classBody += definition;

			if (props[props.length - 1] !== prop) classBody += '\n';

			if (prop.enum) {
				const enumClassName = this.namingStrategy.getClassName(
					this.meta.collection + '_' + prop.fieldNames[0],
					'_'
				);
				enumDefinitions.push(this.getEnumClassDefinition(enumClassName));
			}
		});

		let file = '';

		if (enumDefinitions.length) {
			file += enumDefinitions.join('\n');
			file += '\n\n';
		}

		this.coreImports.add('Entity');

		file += `@Entity<${this.meta.className}>(${this.quote(this.meta.className)}, {\n\tprovider: new MikroBackendProvider(Orm${this.meta.className}, connection, { backendDisplayName: '${friendlyNameForDatabaseType(this.databaseType)}'})`;

		if (props.length === 1 && props[0].primary) {
			// Special case. If there's a single primary key field in this entity, right now that requires that it's a client side generated primary key.
			// There's no reason this has to be the case, but it's a current limitation, so we should generate a working project for them.
			// We should be able to remove this in the future and allow users to use it both ways.
			file += `,\n\tapiOptions: { clientGeneratedPrimaryKeys: true },\n})\n`;
		} else {
			file += `\n})\n`;
		}

		file += `export class ${this.meta.className} {\n`;
		file += `${classBody}}\n`;
		const imports = [
			`import { ${[...this.coreImports].sort().join(', ')} } from '@exogee/graphweaver';`,
		];

		if (this.scalarImports.size > 0) {
			imports.push(
				`import { ${[...this.scalarImports]
					.sort()
					.join(', ')} } from '@exogee/graphweaver-scalars';`
			);
		}

		imports.push(`import { MikroBackendProvider } from '@exogee/graphweaver-mikroorm';`);

		const entityImports = [...this.entityImports].filter((e) => e !== this.meta.className);
		entityImports.sort().forEach((entity) => {
			imports.push(`import { ${entity} } from './${pascalToKebabCaseString(entity)}';`);
		});

		imports.push(
			`import { ${this.enumImports.size > 0 ? [...this.enumImports].sort().join(', ') + ', ' : ''}${
				this.meta.className
			} as Orm${this.meta.className} } from '../entities';`,
			`import { connection } from '../database';`
		);

		file = `${imports.join('\n')}\n\n${file}`;

		return file;
	}

	protected getTypescriptPropertyType(prop: EntityProperty): string {
		if ([ReferenceKind.ONE_TO_ONE, ReferenceKind.MANY_TO_ONE].includes(prop.kind)) {
			return prop.type.charAt(0).toUpperCase() + prop.type.slice(1);
		}

		if (['jsonb', 'json', 'any'].includes(prop.columnTypes?.[0])) {
			return `Record<string, unknown>`;
		}

		if (prop.columnTypes?.[0] === 'date') {
			return 'Date';
		}

		if (prop.type === 'unknown') {
			//fallback to string if unknown
			return 'string';
		}

		if (prop.type === 'bigint') {
			return 'string';
		}

		return prop.runtimeType;
	}

	protected getPropertyDefinition(prop: EntityProperty): string {
		const padding = '\t';

		if ([ReferenceKind.ONE_TO_MANY, ReferenceKind.MANY_TO_MANY].includes(prop.kind)) {
			this.entityImports.add(prop.type);
			return `${padding}${prop.name}!: ${prop.type}[];\n`;
		}

		// string defaults are usually things like SQL functions, but can be also enums, for that `useDefault` should be true
		const isEnumOrNonStringDefault = prop.enum || typeof prop.default !== 'string';
		const useDefault = prop.default != null && isEnumOrNonStringDefault;
		const optional = prop.nullable ? '?' : useDefault ? '' : '!';

		const file = `${prop.name}${optional}: ${this.getTypescriptPropertyType(prop)}`;

		if (!useDefault) {
			return `${padding + file};\n`;
		}

		if (prop.enum && typeof prop.default === 'string') {
			return `${padding}${file} = ${prop.runtimeType}.${identifierForEnumValue(prop.default)};\n`;
		}

		return `${padding}${prop.name} = ${prop.default};\n`;
	}

	protected getEnumClassDefinition(enumClassName: string): string {
		this.coreImports.add('graphweaverMetadata');
		this.enumImports.add(enumClassName);
		return `graphweaverMetadata.collectEnumInformation({ target: ${enumClassName}, name: ${this.quote(enumClassName)} });`;
	}

	private getGraphQLPropertyType(prop: EntityProperty): string {
		if (prop.primary) {
			this.coreImports.add('ID');
			return 'ID';
		}

		if (prop.runtimeType === 'Date') {
			this.scalarImports.add('ISODateStringScalar');
			return 'ISODateStringScalar';
		}

		if (prop.columnTypes?.[0] === 'date') {
			return 'DateScalar';
		}

		if (prop.runtimeType === 'unknown') {
			return 'String';
		}

		if (prop.runtimeType === 'bigint') {
			this.scalarImports.add('GraphQLBigInt');
			return 'GraphQLBigInt';
		}

		if (prop.runtimeType === 'Buffer') {
			this.scalarImports.add('GraphQLByte');
			return 'GraphQLByte';
		}

		if (['jsonb', 'json', 'any'].includes(prop.columnTypes?.[0])) {
			this.scalarImports.add('GraphQLJSON');
			return `GraphQLJSON`;
		}

		if (prop.runtimeType?.includes('[]')) {
			return `[${prop.type.charAt(0).toUpperCase() + prop.type.slice(1).replace('[]', '')}]`;
		}

		if ([ReferenceKind.ONE_TO_ONE, ReferenceKind.MANY_TO_ONE].includes(prop.kind)) {
			return prop.type.charAt(0).toUpperCase() + prop.type.slice(1);
		}

		if ([ReferenceKind.MANY_TO_MANY, ReferenceKind.ONE_TO_MANY].includes(prop.kind)) {
			return `[${prop.type.charAt(0).toUpperCase() + prop.type.slice(1).replace('[]', '')}]`;
		}

		if (prop.pivotTable) {
			return `[${prop.type.charAt(0).toUpperCase() + prop.type.slice(1)}]`;
		}

		const lastChanceType = prop.runtimeType ?? prop.type;

		if (!lastChanceType) {
			console.error(`Property is malformed, it has no type or runtimeType:`, prop);
			throw new Error(`Property ${prop.name} on ${prop.entity} entity has no type or runtimeType.`);
		}

		return lastChanceType.charAt(0).toUpperCase() + lastChanceType.slice(1);
	}

	private getPropertyDecorator(prop: EntityProperty): string {
		const padding = '\t';
		const options = {} as Dictionary;
		let decorator = this.getDecoratorType(prop);

		if (prop.kind === ReferenceKind.MANY_TO_MANY) {
			this.getManyToManyDecoratorOptions(options, prop);
		} else if (prop.kind === ReferenceKind.ONE_TO_MANY) {
			this.getOneToManyDecoratorOptions(options, prop);
		} else if (prop.kind !== ReferenceKind.SCALAR) {
			this.getForeignKeyDecoratorOptions(options, prop);
		}

		this.getCommonDecoratorOptions(options, prop);
		decorator = [decorator].map((d) => padding + d).join('\n');

		if (!Utils.hasObjectKeys(options)) {
			return `${decorator}(() => ${this.getGraphQLPropertyType(prop)})\n`;
		}

		return `${decorator}(() => ${this.getGraphQLPropertyType(prop)}, { ${Object.entries(options)
			.map(([opt, val]) => `${opt}: ${JSON.stringify(val).replaceAll('"', '')}`)
			.join(', ')} })\n`;
	}

	protected getCommonDecoratorOptions(options: Dictionary, prop: EntityProperty): void {
		if (prop.nullable && !prop.mappedBy) {
			options.nullable = true;
		}

		if (prop.primary) {
			options.primaryKeyField = true;
		}

		// If there's a property called 'name' it should be the summary field. If not, and there's a field called 'title'
		// then it should be the summary field.
		if (prop.name === 'name') {
			options.adminUIOptions = { summaryField: true };
		} else if (prop.name === 'title' && !this.meta.props.find((prop) => prop.name === 'name')) {
			options.adminUIOptions = { summaryField: true };
		}
	}

	protected getManyToManyDecoratorOptions(options: Dictionary, prop: EntityProperty) {
		this.entityImports.add(prop.type);
		options.relatedField = this.quote(pluralize(pascalToCamelCaseString(this.meta.className)));
	}

	protected getOneToManyDecoratorOptions(options: Dictionary, prop: EntityProperty) {
		this.entityImports.add(prop.type);
		options.relatedField = this.quote(prop.mappedBy);
	}

	protected getForeignKeyDecoratorOptions(options: Dictionary, prop: EntityProperty) {
		this.entityImports.add(prop.type);

		const relatedEntity = this.entityLookup.get(prop.type);
		if (!relatedEntity) {
			throw new Error(
				`Internal Error: Related entity ${prop.type} should exist but could not be found in the entity lookup.`
			);
		}
		if (!isEntityWithSinglePrimaryKey(relatedEntity)) {
			throw new Error(`Composite primary keys are not supported.`);
		}
		const [primaryKey] = relatedEntity.getPrimaryProps();

		options.id = `(entity) => entity.${prop.name}?.${primaryKey.name}`;
	}

	protected getDecoratorType(prop: EntityProperty): string {
		if ([ReferenceKind.ONE_TO_ONE, ReferenceKind.MANY_TO_ONE].includes(prop.kind)) {
			this.coreImports.add('RelationshipField');
			return `@RelationshipField<${this.meta.className}>`;
		}

		if ([ReferenceKind.ONE_TO_MANY, ReferenceKind.MANY_TO_MANY].includes(prop.kind)) {
			this.coreImports.add('RelationshipField');
			return `@RelationshipField<${prop.type}>`;
		}

		this.coreImports.add('Field');
		return '@Field';
	}
}
