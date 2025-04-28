import { Injectable, NotFoundException, ForbiddenException, ConflictException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Transaction } from './entities/transaction.entity';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { QueryTransactionDto } from './dto/query-transaction.dto';
import { TransactionStatus } from './enums/transaction-status.enum';
import { Currency } from 'src/currencies/entities/currency.entity';

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name); 

  constructor(
    @InjectRepository(Transaction)
    private transactionsRepository: Repository<Transaction>,

    @InjectRepository(Currency)
    private readonly currencyRepository: Repository<Currency>,
  ) {}

  async createTransaction(createTransactionDto: CreateTransactionDto): Promise<Transaction> {
    const { userId, currencyId, amount, type, description, sourceAccount, destinationAccount, reference } = createTransactionDto;
  
    if (reference) {
      const existingTransaction = await this.transactionsRepository.findOne({
        where: { reference },
      });
  
      if (existingTransaction) {
        throw new ConflictException(`Transaction with reference ${reference} already exists`);
      }
    }
  
    const currency = await this.currencyRepository.findOne({
      where: { id: currencyId },
    });
  
    if (!currency) {
      throw new NotFoundException('Currency not found.');
    }
  
    const feePercentage = currency.feePercentage ?? 0;
  
    const feeAmount = Number((amount * feePercentage).toFixed(2));
    const commissionAmount = feeAmount;
    const totalAmount = Number((amount + feeAmount).toFixed(2));
  
    this.logger.log(`Transaction Fee Breakdown:
      User ID: ${userId}
      Base Amount: ${amount}
      Fee Percentage: ${feePercentage * 100}%
      Fee Amount: ${feeAmount}
      Commission Amount: ${commissionAmount}
      Total Amount (Amount + Fee): ${totalAmount}
    `);
  
    const transaction = this.transactionsRepository.create({
      userId,
      type,
      amount: totalAmount,
      currencyId,
      status: createTransactionDto.status ?? TransactionStatus.PENDING,
      reference: reference ?? this.generateReference(),
      description,
      sourceAccount,
      destinationAccount,
      feeAmount,
      feeCurrencyId: currencyId,
      metadata: {
        baseAmount: amount,
        feePercentage,
        feeAmount,
        commissionAmount,
        totalAmount,
      },
    });
  
    return await this.transactionsRepository.save(transaction);
  }
  


  private generateReference(): string {
    return 'TXN-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  async findAll(userId: string, queryParams?: QueryTransactionDto): Promise<Transaction[]> {
    const query = this.transactionsRepository.createQueryBuilder('transaction')
      .where('transaction.userId = :userId', { userId });

    // Apply filters if provided
    if (queryParams?.type) {
      query.andWhere('transaction.type = :type', { type: queryParams.type });
    }
    
    if (queryParams?.status) {
      query.andWhere('transaction.status = :status', { status: queryParams.status });
    }
    
    if (queryParams?.currencyId) {
      query.andWhere('transaction.currencyId = :currencyId', { currencyId: queryParams.currencyId });
    }

    // Order by most recent first
    query.orderBy('transaction.createdAt', 'DESC');

    return query.getMany();
  }

  async findOne(id: string, userId: string): Promise<Transaction> {
    const transaction = await this.transactionsRepository.findOne({
      where: { id }
    });

    if (!transaction) {
      throw new NotFoundException(`Transaction with ID ${id} not found`);
    }

    // Enforce user-based access control
    if (transaction.userId !== userId) {
      throw new ForbiddenException('You do not have permission to access this transaction');
    }

    return transaction;
  }

  async findByReference(reference: string): Promise<Transaction> {
    const transaction = await this.transactionsRepository.findOne({
      where: { reference }
    });

    if (!transaction) {
      throw new NotFoundException(`Transaction with reference ${reference} not found`);
    }

    return transaction;
  }

  async update(id: string, updateTransactionDto: UpdateTransactionDto, userId: string): Promise<Transaction> {
    // First check if the transaction exists and belongs to the user
    const transaction = await this.findOne(id, userId);

    // If reference is being updated, check for uniqueness
    if (updateTransactionDto.reference && updateTransactionDto.reference !== transaction.reference) {
      const existingTransaction = await this.transactionsRepository.findOne({
        where: { reference: updateTransactionDto.reference }
      });

      if (existingTransaction) {
        throw new ConflictException(`Transaction with reference ${updateTransactionDto.reference} already exists`);
      }
    }

    // If updating status to COMPLETED, set completionDate if not provided
    if (updateTransactionDto.status === TransactionStatus.COMPLETED && !updateTransactionDto.completionDate) {
      updateTransactionDto.completionDate = new Date();
    }

    // Merge changes and save
    Object.assign(transaction, updateTransactionDto);
    return this.transactionsRepository.save(transaction);
  }

  async remove(id: string, userId: string): Promise<void> {
    const transaction = await this.findOne(id, userId);
    await this.transactionsRepository.remove(transaction);
  }

  async generateUniqueReference(prefix = 'TXN'): Promise<string> {
    // Generate a unique reference with format PREFIX-TIMESTAMP-RANDOM
    const timestamp = Date.now().toString();
    const random = uuidv4().substring(0, 8);
    return `${prefix}-${timestamp}-${random}`;
  }
}