import { Entity, Column, PrimaryGeneratedColumn, OneToMany } from 'typeorm';
import { Reaction } from './reaction.entity';

@Entity('news')
export class News {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  external_id: number;

  @Column()
  title: string;

  @Column()
  link: string;

  @Column({ nullable: true })
  content: string;

  @Column({ type: 'date' })
  date: Date;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;

  @OneToMany(() => Reaction, reaction => reaction.news)
  reactions: Reaction[];
}
