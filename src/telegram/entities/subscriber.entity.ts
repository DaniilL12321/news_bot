import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('subscribers')
export class Subscriber {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  telegram_id: number;

  @Column('text', { array: true, default: [] })
  categories: string[];

  @Column({ type: 'text', nullable: true })
  address: string | null;

  @Column({ type: 'float8', nullable: true })
  latitude: number | null;

  @Column({ type: 'float8', nullable: true })
  longitude: number | null;

  @Column({ type: 'boolean', default: false })
  waitingForAddress: boolean;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;
}
