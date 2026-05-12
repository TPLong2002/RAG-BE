import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { CollectionService } from './collection.service';
import {
  CreateCollectionDto,
  UpdateCollectionDto,
  AddDocumentsDto,
} from './dto/collection.dto';
import { AuthGuard } from '../../common/guards/auth.guard';
import { UserId } from '../../common/decorators/user-id.decorator';

@Controller('api/collections')
@UseGuards(AuthGuard)
export class CollectionController {
  constructor(private collectionService: CollectionService) {}

  @Post()
  async create(@Body() dto: CreateCollectionDto, @UserId() userId: string) {
    const collection = await this.collectionService.createCollection(
      dto.name,
      userId,
      dto.description,
    );
    return { collection };
  }

  @Get()
  async list(@UserId() userId: string) {
    const collections = await this.collectionService.listCollections(userId);
    return { collections };
  }

  @Get(':id')
  async getOne(@Param('id') id: string) {
    const result = await this.collectionService.getCollection(id);
    if (!result) return { error: 'Collection not found' };
    return result;
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateCollectionDto) {
    const updated = await this.collectionService.updateCollection(id, dto);
    return { success: updated };
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    await this.collectionService.deleteCollection(id);
    return { success: true };
  }

  @Post(':id/documents')
  async addDocuments(@Param('id') id: string, @Body() dto: AddDocumentsDto) {
    const added = await this.collectionService.addDocuments(id, dto.documentIds);
    return { added };
  }

  @Delete(':id/documents/:docId')
  async removeDocument(
    @Param('id') id: string,
    @Param('docId') docId: string,
  ) {
    await this.collectionService.removeDocument(id, docId);
    return { success: true };
  }
}
