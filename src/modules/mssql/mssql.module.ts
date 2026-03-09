import { Module } from '@nestjs/common';
import { MssqlService } from './mssql.service';

@Module({
  providers: [MssqlService],
  exports: [MssqlService],
})
export class MssqlModule {}
