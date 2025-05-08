import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { entities } from './entities';

export const connection = {
	connectionManagerId: 'postgresql',
	mikroOrmConfig: {
		entities,
		driver: PostgreSqlDriver,
		dbName: process.env.DATABASE_NAME || 'nested',
		host: process.env.DATABASE_HOST || 'localhost',
		user: process.env.DATABASE_USER || 'postgres',
		password: process.env.DATABASE_PASSWORD || '',
		port: process.env.DATABASE_PORT ? parseInt(process.env.DATABASE_PORT) : 5432,
	},
};

export const connections = [connection];
